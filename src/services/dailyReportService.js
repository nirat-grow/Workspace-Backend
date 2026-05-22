const cron = require("node-cron");
const prisma = require("../prisma");
const sendTelegram = require("./telegram");
const { buildDailyReport } = require("./reportBuilder");

// Runs every minute and sends report only at configured IST time.
cron.schedule("* * * * *", async () => {
  const nowIST = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const hour = Number(process.env.DAILY_REPORT_HOUR || 19);
  const minute = Number(process.env.DAILY_REPORT_MINUTE || 0);

  if (nowIST.getHours() !== hour || nowIST.getMinutes() !== minute) return;

  const workspaces = await prisma.workspace.findMany();

  for (const workspace of workspaces) {
    const { message } = await buildDailyReport(workspace.id);
    await sendTelegram(message);
  }
});
