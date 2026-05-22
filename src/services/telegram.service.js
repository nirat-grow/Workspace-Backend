const axios = require('axios');
const prisma = require('../config/db');

exports.sendMessage = async (text, specificChatId = null, replyMarkup = null) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = specificChatId || process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.log('Telegram credentials not set. Skipping message:', text);
    return;
  }

  try {
    const payload = {
      chat_id: chatId,
      text,
      parse_mode: 'Markdown'
    };
    
    if (replyMarkup) {
      payload.reply_markup = replyMarkup;
    }

    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, payload);
  } catch (error) {
    console.error('Error sending Telegram message:', error);
  }
};

let lastUpdateId = 0;

exports.startPolling = () => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  setInterval(async () => {
    try {
      const response = await axios.get(`https://api.telegram.org/bot${token}/getUpdates?offset=${lastUpdateId + 1}&timeout=10`);
      const updates = response.data.result;
      
      for (const update of updates) {
        lastUpdateId = update.update_id;
        
        if (update.callback_query) {
          const callbackData = update.callback_query.data;
          const callbackId = update.callback_query.id;
          
          if (callbackData.startsWith('stop_timer_')) {
            const taskId = callbackData.replace('stop_timer_', '');
            
            const task = await prisma.task.findUnique({ where: { id: taskId } });
            if (task && task.status === 'PROGRESS') {
              if (task.startTime && !task.endTime) {
                const endTimeVal = new Date();
                const diffMs = endTimeVal.getTime() - new Date(task.startTime).getTime();
                let hoursVal = diffMs / (1000 * 60 * 60);
                if (hoursVal < 0.01) hoursVal = 0.01;
                
                await prisma.timeLog.create({
                  data: {
                    hours: parseFloat(hoursVal.toFixed(2)),
                    note: 'Auto-logged: Stopped directly from Telegram reminder',
                    taskId: task.id,
                    userId: task.assigneeId
                  }
                });
              }
              
              await prisma.task.update({
                where: { id: task.id },
                data: { status: 'TODO', startTime: null, endTime: null }
              });

              await axios.post(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
                callback_query_id: callbackId,
                text: '✅ Task Stopped successfully! Hours logged.',
                show_alert: true
              });
            } else {
              await axios.post(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
                callback_query_id: callbackId,
                text: '⚠️ Task is not running.',
                show_alert: true
              });
            }
          }
        }
      }
    } catch (err) {
      // Quietly ignore polling network timeouts
    }
  }, 3000);
};
