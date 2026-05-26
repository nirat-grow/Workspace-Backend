const cron = require('node-cron');
const reportService = require('../services/report.service');

const hour = process.env.DAILY_REPORT_HOUR || 19;
const minute = process.env.DAILY_REPORT_MINUTE || 0;

// Job 1 — Daily Report
cron.schedule(`${minute} ${hour} * * *`, () => {
  console.log('Running Daily Report Job');
  reportService.sendDailyReport();
}, {
  timezone: "Asia/Kolkata"
});

// Job 2 — Stuck Task Alert (runs every 6 hours)
cron.schedule('0 */6 * * *', () => {
  console.log('Running Stuck Task Alert Job');
  reportService.sendStuckTaskAlert();
});

// Job 3 — End of Day Timer Alert (Runs at 18:30 / 6:30 PM daily)
cron.schedule('30 18 * * *', () => {
  console.log('Running End of Day Timer Alert Job');
  reportService.sendEndDayTimerAlert();
}, {
  timezone: "Asia/Kolkata"
});

// Job 4 — Morning Timer Alert (Runs at 09:30 AM daily)
cron.schedule('30 9 * * *', () => {
  console.log('Running Morning Timer Alert Job');
  reportService.sendMorningTimerAlert();
}, {
  timezone: "Asia/Kolkata"
});

console.log(`Cron jobs initialized. Daily report set to run at ${hour}:${minute} IST. End-day alerts at 18:30 IST. Morning alerts at 09:30 IST.`);
