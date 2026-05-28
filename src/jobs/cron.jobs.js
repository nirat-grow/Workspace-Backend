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

// Job 3 — End of Day Timer Alert (Runs at 18:30 / 6:30 PM, Mon-Fri)
cron.schedule('30 18 * * 1-5', () => {
  console.log('Running End of Day Timer Alert Job');
  reportService.sendEndDayTimerAlert();
}, {
  timezone: "Asia/Kolkata"
});

// Job 4 — Morning Timer Alert (Runs at 09:30 AM, Mon-Sat)
cron.schedule('30 9 * * 1-6', () => {
  console.log('Running Morning Timer Alert Job');
  reportService.sendMorningTimerAlert();
}, {
  timezone: "Asia/Kolkata"
});

// Job 5 — Lunch Time Alert (Runs at 13:30 / 1:30 PM, Mon-Sat)
cron.schedule('30 13 * * 1-6', () => {
  console.log('Running Lunch Time Alert Job');
  reportService.sendLunchTimeAlert();
}, {
  timezone: "Asia/Kolkata"
});

// Job 6 — Post Lunch Timer Alert (Runs at 14:30 / 2:30 PM, Mon-Fri)
cron.schedule('30 14 * * 1-5', () => {
  console.log('Running Post Lunch Timer Alert Job');
  reportService.sendPostLunchTimerAlert();
}, {
  timezone: "Asia/Kolkata"
});

// Job 7 — Leader Running Task Alerts (Runs at 13:33 / 1:33 PM, Mon-Sat)
cron.schedule('33 13 * * 1-6', () => {
  console.log('Running Leader Running Task Alert Job (13:33)');
  reportService.sendLeaderRunningTaskAlert();
}, {
  timezone: "Asia/Kolkata"
});

// Job 8 — Leader Running Task Alerts (Runs at 18:30 / 6:30 PM, Mon-Fri)
cron.schedule('30 18 * * 1-5', () => {
  console.log('Running Leader Running Task Alert Job (18:30)');
  reportService.sendLeaderRunningTaskAlert();
}, {
  timezone: "Asia/Kolkata"
});

console.log(`Cron jobs initialized. Daily report set to run at ${hour}:${minute} IST. Morning alerts at 09:30 IST. Lunch alerts at 13:30 and 14:30 IST. End-day alerts at 18:30 IST. Leader alerts at 13:33 and 18:30 IST.`);

