require('dotenv').config();
const fetch = require('node-fetch');
const mysql = require('mysql2/promise');

const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME
});

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`;

function calculateEMA(data, period) {
  const k = 2 / (period + 1);
  let ema = [];
  let sum = 0;

  for (let i = 0; i < data.length; i++) {
    const close = data[i].close;
    if (i < period) {
      sum += close;
      ema.push(null);
    } else if (i === period) {
      const sma = sum / period;
      ema.push(sma);
    } else {
      const prev = ema[i - 1];
      const next = (close - prev) * k + prev;
      ema.push(next);
    }
  }
  return ema;
}

function calculateRSI(data, period = 14) {
  let rsi = new Array(data.length).fill(null);
  for (let i = period; i < data.length; i++) {
    let gain = 0, loss = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = data[j].close - data[j - 1].close;
      if (diff > 0) gain += diff;
      else loss -= diff;
    }
    const rs = gain / (loss || 1);
    rsi[i] = 100 - (100 / (1 + rs));
  }
  return rsi;
}

function emaCrossUp(e20Prev, e50Prev, e20Now, e50Now) {
  return e20Prev < e50Prev && e20Now > e50Now;
}

function emaCrossDown(e20Prev, e50Prev, e20Now, e50Now) {
  return e20Prev > e50Prev && e20Now < e50Now;
}

async function fetchAndAnalyze() {
  const res = await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=100');
  const json = await res.json();

  const candles = json.map(d => ({
    time: d[0] / 1000,
    open: +d[1],
    high: +d[2],
    low: +d[3],
    close: +d[4],
  }));

  const ema20 = calculateEMA(candles, 20);
  const ema50 = calculateEMA(candles, 50);
  const rsi = calculateRSI(candles);

  const i = candles.length - 1;
  const prev = candles[i - 1];
  const curr = candles[i];

  const e20Prev = ema20[i - 1], e50Prev = ema50[i - 1];
  const e20Now = ema20[i], e50Now = ema50[i];
  const rsiNow = rsi[i];

  let signal = null;

  if (emaCrossUp(e20Prev, e50Prev, e20Now, e50Now) && rsiNow < 40) {
    signal = 'BUY';
  } else if (emaCrossDown(e20Prev, e50Prev, e20Now, e50Now) && rsiNow > 60) {
    signal = 'SELL';
  }

  if (signal) {
    const price = curr.close;
    const tp = signal === 'BUY' ? (price * 1.01).toFixed(2) : (price * 0.99).toFixed(2);
    const sl = signal === 'BUY' ? (price * 0.99).toFixed(2) : (price * 1.01).toFixed(2);
    const trailing = (price * 0.003).toFixed(2);

    const formatSinyal = `${signal.toLowerCase()} @${price} TP @${tp} SL @${sl} trailing stop @${trailing}`;
    const tgl = new Date(curr.time * 1000).toISOString().slice(0, 19).replace('T', ' ');

    await db.query(
      'INSERT INTO sinyal_scalping (tgl, sinyal, real, format_sinyal) VALUES (?, ?, ?, ?)',
      [tgl, signal, '-', formatSinyal]
    );

    await fetch(TELEGRAM_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: process.env.CHAT_ID,
        text: `📊 ${formatSinyal}`
      })
    });

    console.log(`[${tgl}] ${formatSinyal}`);
  } else {
    console.log(`[${new Date().toLocaleString()}] Tidak ada sinyal`);
  }
}

setInterval(fetchAndAnalyze, 5 * 60 * 1000);
fetchAndAnalyze();
