require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const moment = require('moment');
const uzMonths = [
  'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
  'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'
];

const token = process.env.BOT_TOKEN;
const adminChatId = process.env.ADMIN_CHAT_ID;

const bot = new TelegramBot(token, { polling: true });

const bookingsFile = 'bookings.json';

const WORK_START = moment('09:00', 'HH:mm');
const WORK_END = moment('21:00', 'HH:mm');

const users = {};

// JSONdan bandliklarni o'qish - xatoliklarga chidamli
function getBookings() {
  if (!fs.existsSync(bookingsFile)) return [];
  try {
    const data = fs.readFileSync(bookingsFile, 'utf8');
    return JSON.parse(data || '[]');
  } catch (error) {
    console.error('Bookings faylini o‘qishda xatolik:', error);
    return [];
  }
}

function saveBooking(booking) {
  const bookings = getBookings();
  bookings.push(booking);
  fs.writeFileSync(bookingsFile, JSON.stringify(bookings, null, 2));
}

function removeBooking(id) {
  let bookings = getBookings();
  bookings = bookings.filter(b => b.id !== id);
  fs.writeFileSync(bookingsFile, JSON.stringify(bookings, null, 2));
}

function isTimeOverlap(start1, end1, start2, end2) {
  return start1 < end2 && start2 < end1;
}

function isAvailable(date, from, to) {
  const fromTime = moment(from, 'HH:mm');
  const toTime = moment(to, 'HH:mm');
  if (fromTime < WORK_START || toTime > WORK_END || fromTime >= toTime) return false;

  const bookings = getBookings().filter(b => b.date === date);
  for (const b of bookings) {
    const bStart = moment(b.from, 'HH:mm');
    const bEnd = moment(b.to, 'HH:mm');
    if (isTimeOverlap(fromTime, toTime, bStart, bEnd)) return false;
  }
  return true;
}

function generateId() {
  return Math.random().toString(36).substring(2, 10);
}

function formatDate(dateStr) {
  // YYYY-MM-DD dan YYYY.MM.DD ga o‘zgartirish
  return dateStr.replace(/-/g, '.');
}

function parseDate(dateStr) {
  // YYYY.MM.DD dan YYYY-MM-DD ga o‘zgartirish
  return dateStr.replace(/\./g, '-');
}

// Boshlanish - ism so‘rash
bot.onText(/\/start/, msg => {
  bot.sendMessage(msg.chat.id, 'Salom! Iltimos, ismingizni kiriting:');
  users[msg.chat.id] = { step: 'awaiting_name' };
});

bot.on('message', msg => {
  const id = msg.chat.id;
  const text = msg.text;

  if (!users[id] || text.startsWith('/')) return;

  const state = users[id];

if (state.step === 'awaiting_name') {
  state.name = text;
  state.step = 'awaiting_date';

  const today = moment();
const buttons = [];
let row = [];

for (let i = 0; i < 15; i++) {
  const date = today.clone().add(i, 'days');
  const fullDate = date.format('YYYY.MM.DD');
  const dayOnly = date.format('DD');

  row.push({ text: dayOnly, callback_data: `date_${fullDate}` });

  // Har 3 ta tugmadan so'ng yangi qator
  if ((i + 1) % 3 === 0 || i === 14) {
    buttons.push(row);
    row = [];
  }
}


  bot.sendMessage(id, `Assalomu alaykum, ${state.name}!\n\nIltimos, band qilmoqchi bo‘lgan kunni tanlang:`, {
    reply_markup: {
      inline_keyboard: buttons
    }
  });

  return;
}


  if (state.step === 'awaiting_time') {
    const match = text.match(/^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/);
    if (!match) return bot.sendMessage(id, '❌ Noto‘g‘ri format. Masalan: 10:00 - 12:00');

    const [, from, to] = match;
    if (!isAvailable(state.date, from, to)) {
      return bot.sendMessage(id, '❌ Bu vaqt band yoki noto‘g‘ri. Iltimos, boshqa vaqt kiriting.');
    }

    state.from = from;
    state.to = to;
    state.step = 'awaiting_phone';
    return bot.sendMessage(id, 'Telefon raqamingizni kiriting:');
  }

  if (state.step === 'awaiting_phone') {
    state.phone = text;

    // Buyurtmani saqlaymiz
    const bookingId = generateId();
    const booking = {
      id: bookingId,
      name: state.name,
      phone: state.phone,
      date: state.date,
      from: state.from,
      to: state.to,
      userId: id
    };
    saveBooking(booking);

    bot.sendMessage(id, `✅ Band qilindi!\n🗓 Sana: ${formatDate(booking.date)}\n⏰ Vaqt: ${booking.from} - ${booking.to}`);

    // Admin guruhiga xabar yuborish va bekor qilish tugmasi bilan
    const adminMsg = `
📢 Yangi buyurtma:

Ism: ${booking.name}
Telefon: ${booking.phone}
Sana: ${formatDate(booking.date)}
Vaqt: ${booking.from} - ${booking.to}
ID: ${booking.id}
    `;

    const opts = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '❌ Bekor qilish', callback_data: `cancel_${booking.id}` }
          ]
        ]
      }
    };

    bot.sendMessage(adminChatId, adminMsg, opts);

    delete users[id];
  }
});

// Sana tugmasi bosilganda
bot.on('callback_query', query => {
  const data = query.data;
  const msg = query.message;
  const id = query.message.chat.id;

  if (data.startsWith('date_')) {
    const selectedDate = parseDate(data.split('_')[1]); // YYYY.MM.DD -> YYYY-MM-DD

    // Sana bandliklarini ko'rsatish uchun vaqtlarni olish
    const bookings = getBookings().filter(b => b.date === selectedDate);
    let busyTimes = 'Band qilingan vaqtlar:\n';
    if (bookings.length === 0) busyTimes += 'Hozircha mavjud emas.';
    else {
      bookings.forEach(b => {
        busyTimes += `- ${b.from} - ${b.to}\n`;
      });
    }

    users[id].date = selectedDate;
    users[id].step = 'awaiting_time';

    const selectedMoment = moment(selectedDate, 'YYYY-MM-DD');
    const day = selectedMoment.date();
    const monthName = uzMonths[selectedMoment.month()];
    const formatted = `${day}-${monthName}`;

    bot.sendMessage(id, `Siz tanlagan sana: ${formatted}\n\n${busyTimes}\n\nIltimos, vaqt oralig‘ini kiriting (masalan: 10:00 - 12:00)`);
    bot.answerCallbackQuery(query.id);
  }

  if (data.startsWith('cancel_')) {
    const bookingId = data.split('_')[1];
    const bookings = getBookings();
    const booking = bookings.find(b => b.id === bookingId);

    if (!booking) {
      return bot.answerCallbackQuery(query.id, { text: 'Buyurtma topilmadi yoki allaqachon bekor qilingan.' });
    }

    removeBooking(bookingId);

    bot.editMessageText(`${msg.text}\n\n❌ Buyurtma bekor qilindi.`, { chat_id: msg.chat.id, message_id: msg.message_id });
    bot.answerCallbackQuery(query.id, { text: 'Buyurtma bekor qilindi.' });

    bot.sendMessage(booking.userId, `Sizning buyurtmangiz ${formatDate(booking.date)} sanasi va ${booking.from} - ${booking.to} vaqti uchun bekor qilindi.`);
  }
});
