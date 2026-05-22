const prisma = require("../prisma");

async function logActivity(data) {
  try {
    await prisma.activityLog.create({
      data: {
        workspaceId: data.workspaceId,
        projectId: data.projectId,
        taskId: data.taskId,
        userId: data.userId,
        action: data.action,
        message: data.message,
        oldValue: data.oldValue || undefined,
        newValue: data.newValue || undefined
      }
    });
  } catch (err) {
    console.log("Activity log error:", err.message);
  }
}

module.exports = logActivity;
