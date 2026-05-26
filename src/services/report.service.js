const prisma = require('../config/db');
const telegramService = require('./telegram.service');

exports.getDailyReport = async (designation = null) => {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const whereBase = designation 
      ? { assignee: { designation: designation, globalRole: 'MEMBER' } }
      : {};

    const doneToday = await prisma.task.count({
      where: { ...whereBase, status: 'DONE', updatedAt: { gte: startOfDay } }
    });

    const inProgress = await prisma.task.count({
      where: { ...whereBase, status: 'PROGRESS' }
    });

    const pending = await prisma.task.count({
      where: { ...whereBase, status: 'TODO' }
    });

    const stuckHours = process.env.STUCK_TASK_HOURS ? parseInt(process.env.STUCK_TASK_HOURS) : 24;
    const stuckTime = new Date(Date.now() - stuckHours * 60 * 60 * 1000);
    const stuck = await prisma.task.count({
      where: {
        ...whereBase,
        status: { in: ['TODO', 'PROGRESS', 'REVIEW'] },
        updatedAt: { lt: stuckTime }
      }
    });

    const overdue = await prisma.task.count({
      where: {
        ...whereBase,
        dueDate: { lt: new Date() },
        status: { not: 'DONE' }
      }
    });

    return { doneToday, inProgress, pending, stuck, overdue };
  } catch (error) {
    console.error('Error generating daily report:', error);
    throw error;
  }
};

exports.sendDailyReport = async () => {
  try {
    // 1. Send Global Report (Admin)
    const globalReport = await this.getDailyReport();
    const dateStr = new Date().toISOString().split('T')[0];

    const globalMessage = `📊 *Global Daily Report — ${dateStr}*\n✅ Done today: ${globalReport.doneToday}\n🔄 In Progress: ${globalReport.inProgress}\n📋 Pending TODO: ${globalReport.pending}\n⚠️ Stuck tasks: ${globalReport.stuck}\n🔴 Overdue: ${globalReport.overdue}`;
    await telegramService.sendMessage(globalMessage);

    // 2. Send Squad Reports (Team Leaders)
    const teamLeaders = await prisma.user.findMany({
      where: { globalRole: 'TEAM_LEADER' },
      select: { telegramId: true, designation: true, name: true }
    });

    for (const leader of teamLeaders) {
      if (leader.telegramId && leader.designation) {
        const squadReport = await this.getDailyReport(leader.designation);
        
        const squadMessage = `📊 *Squad Daily Report — ${leader.designation} (${dateStr})*\nHey ${leader.name}, here is your squad's summary:\n\n✅ Done today: ${squadReport.doneToday}\n🔄 In Progress: ${squadReport.inProgress}\n📋 Pending TODO: ${squadReport.pending}\n⚠️ Stuck tasks: ${squadReport.stuck}\n🔴 Overdue: ${squadReport.overdue}`;
        
        await telegramService.sendMessage(squadMessage, leader.telegramId);
      }
    }
  } catch (error) {
    console.error('Error sending daily report:', error);
  }
};

exports.sendStuckTaskAlert = async () => {
  try {
    const stuckHours = process.env.STUCK_TASK_HOURS ? parseInt(process.env.STUCK_TASK_HOURS) : 24;
    const stuckTime = new Date(Date.now() - stuckHours * 60 * 60 * 1000);
    
    const stuckTasks = await prisma.task.findMany({
      where: {
        status: { in: ['TODO', 'PROGRESS', 'REVIEW'] },
        updatedAt: { lt: stuckTime }
      },
      include: { assignee: true }
    });

    if (stuckTasks.length === 0) return;

    for (const task of stuckTasks) {
      const hoursStuck = Math.floor((Date.now() - new Date(task.updatedAt).getTime()) / (1000 * 60 * 60));
      const message = `🚨 *Stuck Task Alert*\nTask: ${task.taskKey} - ${task.title}\nStatus: ${task.status} | Assignee: ${task.assignee ? task.assignee.name : 'Unassigned'}\nStuck for: ${hoursStuck}h`;
      await telegramService.sendMessage(message);
    }
  } catch (error) {
    console.error('Error sending stuck task alert:', error);
  }
};

exports.sendEndDayTimerAlert = async () => {
  try {
    const activeTasks = await prisma.task.findMany({
      where: { status: 'PROGRESS' },
      include: {
        assignee: { select: { id: true, name: true, telegramId: true } },
        project: { select: { name: true } }
      }
    });

    if (activeTasks.length === 0) return;

    const frontendBase = process.env.FRONTEND_URL || 'http://192.168.0.51';
    const cleanBase = frontendBase.replace(/\/$/, '');
    const backendUrl = `${cleanBase}:${process.env.PORT || 5000}`; 

    for (const task of activeTasks) {
      if (task.assignee && task.assignee.telegramId) {
        const message = `🚨 *Timer Warning!*\nHey ${task.assignee.name}, it's 6:30 PM and your timer for task \`[${task.taskKey}]\` (*${task.title}*) in project *${task.project?.name || 'N/A'}* is still running!\n\nPlease stop it if you are done for the day.`;
        
        const replyMarkup = {
          inline_keyboard: [[
            { text: '🛑 Stop Task Now', callback_data: `stop_timer_${task.id}` }
          ]]
        };

        await telegramService.sendMessage(message, task.assignee.telegramId, replyMarkup);
      }
    }
  } catch (error) {
    console.error('Error sending end day timer alert:', error);
  }
};

exports.sendMorningTimerAlert = async () => {
  try {
    const usersWithPendingTasks = await prisma.user.findMany({
      where: {
        telegramId: { not: null },
        assignedTasks: {
          some: { status: { in: ['TODO', 'REVIEW', 'STUCK'] } }
        }
      }
    });

    if (usersWithPendingTasks.length === 0) return;

    for (const user of usersWithPendingTasks) {
      if (user.telegramId) {
        const message = `🌅 *Good Morning!*\nHey ${user.name}, it's 9:30 AM! ☕\n\nPlease check your board to continue your tasks, and don't forget to start your timer when you begin working.\n\nHave a great and productive day! 🚀`;
        await telegramService.sendMessage(message, user.telegramId);
      }
    }
  } catch (error) {
    console.error('Error sending morning timer alert:', error);
  }
};
