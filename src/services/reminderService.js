const cron = require("node-cron");
const prisma = require("../prisma");
const sendTelegram = require("./telegram");

cron.schedule("* * * * *", async () => {
  const now = new Date();

  const reminders = await prisma.reminder.findMany({
    where: {
      remindAt: { lte: now },
      sent: false
    }
  });

  for (const reminder of reminders) {
    const task = await prisma.task.findUnique({ where: { id: reminder.taskId } });
    if (task) {
      await sendTelegram(`🔔 <b>TASK REMINDER</b>\n\n📌 <b>Task:</b> <code>[${task.taskKey}]</code> <b>${task.title}</b>\n⚡ <b>Status:</b> <code>${task.status}</code>\n🔥 <b>Priority:</b> <code>${task.priority}</code>`);
    }

    await prisma.reminder.update({
      where: { id: reminder.id },
      data: { sent: true }
    });
  }
});
