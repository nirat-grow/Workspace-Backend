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

exports.sendLunchTimeAlert = async () => {
  try {
    const activeTasks = await prisma.task.findMany({
      where: { status: 'PROGRESS' },
      include: {
        assignee: { select: { id: true, name: true, telegramId: true } },
        project: { select: { name: true } }
      }
    });

    const allUsers = await prisma.user.findMany({ where: { telegramId: { not: null } } });

    // Check if today is Saturday (6)
    const isSaturday = new Date().getDay() === 6;

    for (const user of allUsers) {
      if (user.telegramId) {
        const userActiveTasks = activeTasks.filter(t => t.assigneeId === user.id);
        
        if (userActiveTasks.length > 0) {
          const task = userActiveTasks[0];
          let message = '';
          if (isSaturday) {
            message = `🎉 *HALF-DAY OVER! HAPPY WEEKEND!* 🎉\nHey ${user.name}, it's 1:30 PM on Saturday! Time to drop everything and run home! 🏃‍♂️💨\n\nYou are still working on \`[${task.taskKey}]\` (*${task.title}*).\n\nPlease stop your task immediately before your weekend starts! 🍻😎`;
          } else {
            message = `🍔 *Lunch Time!*\nHey ${user.name}, it's 1:30 PM! You are currently working on \`[${task.taskKey}]\` (*${task.title}*).\n\nPlease stop your task and take a lunch break! 🍕🍹`;
          }

          const replyMarkup = {
            inline_keyboard: [[
              { text: '🛑 Stop Task Now', callback_data: `stop_timer_${task.id}` }
            ]]
          };
          await telegramService.sendMessage(message, user.telegramId, replyMarkup);
        } else {
          let message = '';
          if (isSaturday) {
            message = `🎉 *HALF-DAY OVER! HAPPY WEEKEND!* 🎉\nHey ${user.name}, it's 1:30 PM! Work is done, go enjoy your weekend! Catch you on Monday! 🍻😎`;
          } else {
            message = `🍔 *Lunch Time!*\nHey ${user.name}, it's 1:30 PM! Take a break, enjoy your lunch and recharge. 🍕🍹`;
          }
          await telegramService.sendMessage(message, user.telegramId);
        }
      }
    }
  } catch (error) {
    console.error('Error sending lunch time alert:', error);
  }
};

exports.sendPostLunchTimerAlert = async () => {
  try {
    const allUsers = await prisma.user.findMany({ where: { telegramId: { not: null } } });

    for (const user of allUsers) {
      if (user.telegramId) {
        const lastTask = await prisma.task.findFirst({
          where: { assigneeId: user.id, status: { in: ['TODO', 'HOLD'] } },
          orderBy: { updatedAt: 'desc' },
          include: { project: { select: { name: true } } }
        });

        if (lastTask) {
          const message = `🚀 *Break is over!*\nHey ${user.name}, it's 2:30 PM! Time to get back to work.\n\nDo you want to continue working on \`[${lastTask.taskKey}]\` (*${lastTask.title}*)? ⏱️`;
          const replyMarkup = {
            inline_keyboard: [[
              { text: '▶️ Continue Task', callback_data: `start_timer_${lastTask.id}` }
            ]]
          };
          await telegramService.sendMessage(message, user.telegramId, replyMarkup);
        } else {
          const message = `🚀 *Break is over!*\nHey ${user.name}, it's 2:30 PM! Time to get back to work. Please check your board and start your tasks! ⏱️`;
          await telegramService.sendMessage(message, user.telegramId);
        }
      }
    }
  } catch (error) {
    console.error('Error sending post lunch timer alert:', error);
  }
};

exports.sendLeaderRunningTaskAlert = async () => {
  try {
    const runningTasks = await prisma.task.findMany({
      where: { status: 'PROGRESS' },
      include: {
        assignee: { select: { id: true, name: true, globalRole: true, teamLeaderId: true, designation: true } },
        project: { select: { name: true } }
      }
    });

    if (runningTasks.length === 0) return;

    const leaders = await prisma.user.findMany({
      where: { telegramId: { not: null }, globalRole: { in: ['ADMIN', 'TEAM_LEADER'] } }
    });

    for (const leader of leaders) {
      if (!leader.telegramId) continue;

      let targetTasks = [];

      if (leader.globalRole === 'ADMIN') {
        targetTasks = runningTasks;
      } else if (leader.globalRole === 'TEAM_LEADER') {
        targetTasks = runningTasks.filter(t => 
          t.assignee && (
            t.assignee.id === leader.id ||
            t.assignee.teamLeaderId === leader.id || 
            (t.assignee.teamLeaderId == null && t.assignee.designation === leader.designation && t.assignee.globalRole === 'MEMBER')
          )
        );
      }

      if (targetTasks.length > 0) {
        let message = `⚠️ *Running Task Alert*\n\nHey ${leader.name ? leader.name.replace(/[*_`]/g, '') : 'Leader'}, here are the members currently running tasks:\n\n`;
        
        targetTasks.forEach(t => {
          const uName = (t.assignee?.name || 'Unassigned').replace(/[*_`]/g, '');
          const pName = (t.project?.name || 'Project').replace(/[*_`]/g, '');
          message += `🔹 *${uName}* is working on \`[${t.taskKey || t.id.slice(0,5)}]\` in ${pName}\n`;
        });

        message += `\nYou can stop specific tasks or stop them all below.`;

        const inline_keyboard = targetTasks.map(t => ([{
          text: `🛑 Stop ${t.assignee?.name || 'Unassigned'}'s Task`,
          callback_data: `stop_timer_${t.id}`
        }]));

        inline_keyboard.push([{
          text: `⛔ Stop All Running Tasks`,
          callback_data: `stop_all_running_${leader.id}`
        }]);

        const replyMarkup = { inline_keyboard };

        await telegramService.sendMessage(message, leader.telegramId, replyMarkup);
      }
    }

  } catch (error) {
    console.error('Error sending leader running task alert:', error);
  }
};
