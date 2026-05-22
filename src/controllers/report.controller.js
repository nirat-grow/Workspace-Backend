const prisma = require('../config/db');
const reportService = require('../services/report.service');

async function getAdminSquadIds(leaderId, prismaClient) {
  if (!leaderId) return null;
  if (leaderId.startsWith('no-leader-')) {
    const designation = leaderId.replace('no-leader-', '');
    const members = await prismaClient.user.findMany({ where: { globalRole: 'MEMBER', designation, teamLeaderId: null } });
    return members.map(m => m.id);
  }
  const leaderUser = await prismaClient.user.findUnique({ where: { id: leaderId } });
  if (leaderUser) {
    const members = await prismaClient.user.findMany({
      where: { OR: [{ teamLeaderId: leaderId }, { AND: [{ teamLeaderId: null }, { designation: leaderUser.designation }] }] }
    });
    return [leaderId, ...members.map(m => m.id)];
  }
  return [];
}

exports.getDaily = async (req, res) => {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const { projectId, targetUserId, startDate, endDate, leaderId } = req.query;
    const isAdmin = req.user.globalRole === 'ADMIN';
    const isTL = req.user.globalRole === 'TEAM_LEADER';
    const isManager = req.user.globalRole === 'MANAGER';
    
    let effectiveUserId = req.user.id;
    
    if (targetUserId && (isAdmin || isManager || isTL)) {
      // Security: TL can only see their team members
      if (isTL && !isAdmin) {
        const target = await prisma.user.findUnique({ where: { id: targetUserId } });
        if (target && (target.teamLeaderId === req.user.id || target.designation === req.user.designation)) {
          effectiveUserId = targetUserId;
        }
      } else {
        effectiveUserId = targetUserId;
      }
    }

    const isPersonalScope = req.query.personal === 'true';
    const showTeamData = isTL && !targetUserId && !isAdmin && !isManager && !isPersonalScope;
    const isPersonal = !isAdmin && !isManager && (!isTL || effectiveUserId === req.user.id || isPersonalScope) && !showTeamData;
    const squadUserIds = isAdmin ? await getAdminSquadIds(leaderId, prisma) : null;
    
    let whereClause = { status: 'TODO' };
    if (showTeamData) {
      whereClause.assignee = {
        OR: [
          { id: req.user.id },
          {
            AND: [
              { globalRole: 'MEMBER' },
              {
                OR: [
                  { teamLeaderId: req.user.id },
                  { AND: [{ teamLeaderId: null }, { designation: req.user.designation }] }
                ]
              }
            ]
          }
        ]
      };
    } else if (isPersonal || targetUserId) {
      whereClause.assigneeId = effectiveUserId;
    } else if (squadUserIds !== null) {
      whereClause.assigneeId = { in: squadUserIds };
    }

    const stuckTime = new Date();
    stuckTime.setHours(stuckTime.getHours() - 48);

    let stuckWhereClause = {
      OR: [
        { status: 'STUCK' },
        { 
          status: { in: ['TODO', 'PROGRESS', 'REVIEW'] },
          updatedAt: { lt: stuckTime }
        }
      ]
    };
    if (showTeamData) {
      stuckWhereClause.assignee = {
        OR: [
          { id: req.user.id },
          {
            AND: [
              { globalRole: 'MEMBER' },
              {
                OR: [
                  { teamLeaderId: req.user.id },
                  { AND: [{ teamLeaderId: null }, { designation: req.user.designation }] }
                ]
              }
            ]
          }
        ]
      };
    } else if (isPersonal || targetUserId) {
      stuckWhereClause.assigneeId = effectiveUserId;
    } else if (squadUserIds !== null) {
      stuckWhereClause.assigneeId = { in: squadUserIds };
    }

    let holdWhereClause = { status: 'HOLD' };
    if (showTeamData) {
      holdWhereClause.assignee = {
        OR: [
          { id: req.user.id },
          {
            AND: [
              { globalRole: 'MEMBER' },
              {
                OR: [
                  { teamLeaderId: req.user.id },
                  { AND: [{ teamLeaderId: null }, { designation: req.user.designation }] }
                ]
              }
            ]
          }
        ]
      };
    } else if (isPersonal || targetUserId) {
      holdWhereClause.assigneeId = effectiveUserId;
    } else if (squadUserIds !== null) {
      holdWhereClause.assigneeId = { in: squadUserIds };
    }

    let progressWhereClause = { status: { in: ['TODO', 'PROGRESS'] } };
    if (showTeamData) {
      progressWhereClause.assignee = {
        OR: [
          { id: req.user.id },
          {
            AND: [
              { globalRole: 'MEMBER' },
              {
                OR: [
                  { teamLeaderId: req.user.id },
                  { AND: [{ teamLeaderId: null }, { designation: req.user.designation }] }
                ]
              }
            ]
          }
        ]
      };
    } else if (isPersonal || targetUserId) {
      progressWhereClause.assigneeId = effectiveUserId;
    } else if (squadUserIds !== null) {
      progressWhereClause.assigneeId = { in: squadUserIds };
    }

    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      whereClause.updatedAt = { gte: start, lte: end };
      stuckWhereClause = {
        status: 'STUCK',
        updatedAt: { gte: start, lte: end }
      };
      holdWhereClause.updatedAt = { gte: start, lte: end };
    }

    if (projectId) {
      whereClause.projectId = projectId;
      stuckWhereClause.projectId = projectId;
      holdWhereClause.projectId = projectId;
      progressWhereClause.projectId = projectId;
    }

    // Ensure all queries are scoped to the user's primary workspace!
    whereClause.project = { workspaceId: req.user.primaryWorkspaceId };
    stuckWhereClause.project = { workspaceId: req.user.primaryWorkspaceId };
    holdWhereClause.project = { workspaceId: req.user.primaryWorkspaceId };
    progressWhereClause.project = { workspaceId: req.user.primaryWorkspaceId };

    const [pending, stuck, hold, progress] = await Promise.all([
      prisma.task.findMany({ where: whereClause, include: { assignee: true, project: true } }),
      prisma.task.findMany({ where: stuckWhereClause, include: { assignee: true, project: true } }),
      prisma.task.findMany({ where: holdWhereClause, include: { assignee: true, project: true } }),
      prisma.task.findMany({ where: progressWhereClause, include: { assignee: true, project: true, timeLogs: { orderBy: { loggedAt: 'desc' } } } })
    ]);

    res.json({ pending, stuck, hold, progress });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getWeekly = async (req, res) => {
  try {
    const { projectId, targetUserId, startDate, endDate, leaderId } = req.query;
    const isAdmin = req.user.globalRole === 'ADMIN';
    const isTL = req.user.globalRole === 'TEAM_LEADER';
    const isManager = req.user.globalRole === 'MANAGER';

    let effectiveUserId = req.user.id;
    if (targetUserId && (isAdmin || isManager || isTL)) {
      if (isTL && !isAdmin) {
        const target = await prisma.user.findUnique({ where: { id: targetUserId } });
        if (target && (target.teamLeaderId === req.user.id || target.designation === req.user.designation)) {
          effectiveUserId = targetUserId;
        }
      } else {
        effectiveUserId = targetUserId;
      }
    }

    const isPersonalScope = req.query.personal === 'true';
    const showTeamData = isTL && !targetUserId && !isAdmin && !isManager && !isPersonalScope;
    const isPersonal = !isAdmin && !isManager && (!isTL || effectiveUserId === req.user.id || isPersonalScope) && !showTeamData;
    const squadUserIds = isAdmin ? await getAdminSquadIds(leaderId, prisma) : null;

    let start = new Date();
    start.setDate(start.getDate() - 7);
    let end = new Date();

    if (startDate && endDate) {
      start = new Date(startDate);
      end = new Date(endDate);
    }

    let whereClause = {
      status: 'DONE',
      updatedAt: { gte: start, lte: end },
      project: { workspaceId: req.user.primaryWorkspaceId }
    };
    if (projectId) whereClause.projectId = projectId;
    if (showTeamData) {
      whereClause.assignee = {
        OR: [
          { id: req.user.id },
          {
            AND: [
              { globalRole: 'MEMBER' },
              {
                OR: [
                  { teamLeaderId: req.user.id },
                  { AND: [{ teamLeaderId: null }, { designation: req.user.designation }] }
                ]
              }
            ]
          }
        ]
      };
    } else if (isPersonal || targetUserId) {
      whereClause.assigneeId = effectiveUserId;
    } else if (squadUserIds !== null) {
      whereClause.assigneeId = { in: squadUserIds };
    }

    const tasks = await prisma.task.findMany({
      where: whereClause,
      include: { assignee: true, project: true, timeLogs: true }
    });

    // Group by day for simple bar chart data covering start to end range based on user's timezone offset
    const dailyCounts = {};
    const tzOffset = req.query.tzOffset ? parseInt(req.query.tzOffset, 10) : 0;

    let currentLocal = new Date(start.getTime() - tzOffset * 60 * 1000);
    currentLocal.setUTCHours(0, 0, 0, 0);
    const endLocal = new Date(end.getTime() - tzOffset * 60 * 1000);
    endLocal.setUTCHours(0, 0, 0, 0);

    while (currentLocal <= endLocal) {
      dailyCounts[currentLocal.toISOString().split('T')[0]] = 0;
      currentLocal.setUTCDate(currentLocal.getUTCDate() + 1);
    }

    tasks.forEach(t => {
      const day = new Date(t.updatedAt.getTime() - tzOffset * 60 * 1000).toISOString().split('T')[0];
      if (dailyCounts[day] !== undefined) {
        dailyCounts[day]++;
      }
    });

    const result = Object.keys(dailyCounts).map(date => ({ date, count: dailyCounts[date] }));
    res.json({ counts: result, tasks });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getMonthly = async (req, res) => {
  try {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0,0,0,0);

    const { projectId } = req.query;
    let whereClause = { 
      createdAt: { gte: startOfMonth },
      project: { workspaceId: req.user.primaryWorkspaceId } 
    };
    if (projectId) whereClause.projectId = projectId;

    const tasks = await prisma.task.findMany({
      where: whereClause
    });

    res.json(tasks);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getOverdue = async (req, res) => {
  try {
    const { projectId, targetUserId, endDate, leaderId } = req.query;
    const isAdmin = req.user.globalRole === 'ADMIN';
    const isTL = req.user.globalRole === 'TEAM_LEADER';
    const isManager = req.user.globalRole === 'MANAGER';

    let effectiveUserId = req.user.id;
    if (targetUserId && (isAdmin || isManager || isTL)) {
      if (isTL && !isAdmin) {
        const target = await prisma.user.findUnique({ where: { id: targetUserId } });
        if (target && (target.teamLeaderId === req.user.id || target.designation === req.user.designation)) {
          effectiveUserId = targetUserId;
        }
      } else {
        effectiveUserId = targetUserId;
      }
    }

    const isPersonalScope = req.query.personal === 'true';
    const showTeamData = isTL && !targetUserId && !isAdmin && !isManager && !isPersonalScope;
    const isPersonal = !isAdmin && !isManager && (!isTL || effectiveUserId === req.user.id || isPersonalScope) && !showTeamData;
    const squadUserIds = isAdmin ? await getAdminSquadIds(leaderId, prisma) : null;

    let checkDate = new Date();
    if (endDate) {
      checkDate = new Date(endDate);
    }

    let whereClause = {
      dueDate: { lt: checkDate },
      status: { not: 'DONE' },
      project: { workspaceId: req.user.primaryWorkspaceId }
    };
    if (projectId) whereClause.projectId = projectId;
    if (showTeamData) {
      whereClause.assignee = {
        OR: [
          { id: req.user.id },
          { AND: [{ globalRole: 'MEMBER' }, { teamLeaderId: req.user.id }] },
          { AND: [{ globalRole: 'MEMBER' }, { teamLeaderId: null }, { designation: req.user.designation }] }
        ]
      };
    } else if (isPersonal || targetUserId) {
      whereClause.assigneeId = effectiveUserId;
    } else if (squadUserIds !== null) {
      whereClause.assigneeId = { in: squadUserIds };
    }

    const overdue = await prisma.task.findMany({
      where: whereClause,
      include: { assignee: true, project: true }
    });

    // Map to add days overdue
    const result = overdue.map(t => {
      const diffTime = Math.abs(checkDate - new Date(t.dueDate));
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      return { ...t, daysOverdue: diffDays };
    }).sort((a, b) => b.daysOverdue - a.daysOverdue);

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getHours = async (req, res) => {
  try {
    const { projectId, targetUserId, startDate, endDate, leaderId } = req.query;
    const isAdmin = req.user.globalRole === 'ADMIN';
    const isTL = req.user.globalRole === 'TEAM_LEADER';
    const isManager = req.user.globalRole === 'MANAGER';

    let effectiveUserId = req.user.id;
    if (targetUserId && (isAdmin || isManager || isTL)) {
      if (isTL && !isAdmin) {
        const target = await prisma.user.findUnique({ where: { id: targetUserId } });
        if (target && (target.teamLeaderId === req.user.id || target.designation === req.user.designation)) {
          effectiveUserId = targetUserId;
        }
      } else {
        effectiveUserId = targetUserId;
      }
    }

    const isPersonalScope = req.query.personal === 'true';
    const showTeamData = isTL && !targetUserId && !isAdmin && !isManager && !isPersonalScope;
    const isPersonal = !isAdmin && !isManager && (!isTL || effectiveUserId === req.user.id || isPersonalScope) && !showTeamData;
    const squadUserIds = isAdmin ? await getAdminSquadIds(leaderId, prisma) : null;

    let teamUserIds = [];
    if (showTeamData) {
      const team = await prisma.user.findMany({
        where: {
          OR: [
            { id: req.user.id },
            { teamLeaderId: req.user.id },
            { AND: [{ teamLeaderId: null }, { designation: req.user.designation }] }
          ]
        },
        select: { id: true }
      });
      teamUserIds = team.map(u => u.id);
    }

    let whereClause = { workspaceId: req.user.primaryWorkspaceId };
    if (projectId) whereClause.id = projectId;

    const projects = await prisma.project.findMany({
      where: whereClause,
      include: {
        tasks: {
          include: { timeLogs: true }
        },
        members: {
          include: { user: true }
        }
      }
    });

    const result = projects.map(p => {
      const totalHours = p.tasks.reduce((sum, task) => {
        return sum + task.timeLogs.reduce((tsum, log) => {
          if (showTeamData && !teamUserIds.includes(log.userId)) return tsum;
          if ((isPersonal || targetUserId) && log.userId !== effectiveUserId) return tsum;
          if (squadUserIds !== null && !squadUserIds.includes(log.userId)) return tsum;
          if (startDate && endDate) {
            const logDate = new Date(log.loggedAt);
            if (logDate < new Date(startDate) || logDate > new Date(endDate)) return tsum;
          }
          return tsum + log.hours;
        }, 0);
      }, 0);

      let memberCount = p.members.length;
      if (showTeamData) {
        memberCount = p.members.filter(m => 
          m.user.id === req.user.id || 
          (m.user.globalRole === 'MEMBER' && (m.user.teamLeaderId === req.user.id || (m.user.teamLeaderId == null && m.user.designation === req.user.designation)))
        ).length;
      } else if (isPersonal || targetUserId) {
        memberCount = 1;
      } else if (squadUserIds !== null) {
        memberCount = p.members.filter(m => squadUserIds.includes(m.userId)).length;
      }

      return {
        id: p.id,
        name: p.name,
        totalHours,
        memberCount,
        tasks: p.tasks.map(t => ({
          id: t.id,
          title: t.title,
          hours: t.timeLogs.reduce((tsum, log) => {
            if (startDate && endDate) {
              const logDate = new Date(log.loggedAt);
              if (logDate < new Date(startDate) || logDate > new Date(endDate)) return tsum;
            }
            return tsum + log.hours;
          }, 0)
        }))
      };
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

exports.triggerTelegram = async (req, res) => {
  try {
    await reportService.sendDailyReport();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getTimesheets = async (req, res) => {
  try {
    const logs = await prisma.timeLog.findMany({
      where: {
        task: { project: { workspaceId: req.user.primaryWorkspaceId } }
      },
      include: {
        user: { select: { id: true, name: true } },
        task: { include: { project: true } }
      },
      orderBy: { loggedAt: 'desc' }
    });
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getDelegated = async (req, res) => {
  try {
    const { projectId } = req.query;
    let whereClause = {
      assignee: {
        OR: [
          { teamLeaderId: req.user.id },
          { AND: [{ globalRole: 'MEMBER' }, { teamLeaderId: null }, { designation: req.user.designation }] }
        ]
      },
      NOT: { assigneeId: req.user.id },
      project: { workspaceId: req.user.primaryWorkspaceId }
    };
    if (projectId) whereClause.projectId = projectId;

    const tasks = await prisma.task.findMany({
      where: whereClause,
      include: { assignee: true, project: true },
      orderBy: { createdAt: 'desc' }
    });
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};
exports.getProjectReport = async (req, res) => {
  try {
    const { projectId, leaderId, startDate, endDate } = req.query;
    if (!projectId) return res.status(400).json({ error: 'Project ID required' });
    
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        members: {
          include: {
            user: {
              select: { id: true, name: true, email: true, globalRole: true, designation: true, profilePic: true }
            }
          }
        },
        tasks: {
          include: {
            timeLogs: true
          }
        }
      }
    });
    
    if (!project) return res.status(404).json({ error: 'Project not found' });
    
    // Calculate stats for each member in the project
    const membersReport = project.members.map(m => {
      let memberTasks = project.tasks.filter(t => t.assigneeId === m.userId);
      if (startDate && endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        memberTasks = memberTasks.filter(t => t.updatedAt >= start && t.updatedAt <= end);
      }

      const totalHours = memberTasks.reduce((sum, t) => {
        return sum + t.timeLogs.filter(l => {
          if (l.userId !== m.userId) return false;
          if (startDate && endDate) {
            const logDate = new Date(l.loggedAt);
            return logDate >= new Date(startDate) && logDate <= new Date(endDate);
          }
          return true;
        }).reduce((tsum, l) => tsum + l.hours, 0);
      }, 0);
      
      return {
        id: m.user.id,
        name: m.user.name,
        email: m.user.email,
        role: m.user.globalRole,
        designation: m.user.designation,
        teamLeaderId: m.user.teamLeaderId,
        profilePic: m.user.profilePic,
        totalHours,
        taskCount: memberTasks.length,
        completedTasks: memberTasks.filter(t => t.status === 'DONE').length
      };
    });

    // If TL is requesting OR Admin provides leaderId, filter the squad
    let filteredMembers = membersReport;
    let leaderObj = null;

    if (req.user.globalRole === 'TEAM_LEADER') {
      leaderObj = {
        id: req.user.id,
        name: req.user.name,
        email: req.user.email,
        globalRole: req.user.globalRole,
        designation: req.user.designation,
        profilePic: req.user.profilePic
      };
      filteredMembers = membersReport.filter(m => m.teamLeaderId === req.user.id || (m.teamLeaderId == null && m.designation === req.user.designation));
    } else if (leaderId) {
      if (leaderId.startsWith('no-leader-')) {
        const designation = leaderId.replace('no-leader-', '');
        leaderObj = {
          id: leaderId,
          name: `${designation} Squad`,
          email: 'No Team Leader assigned yet',
          globalRole: 'TEAM_LEADER',
          designation,
          hasNoLeader: true
        };
        filteredMembers = membersReport.filter(m => m.designation === designation && m.teamLeaderId == null);
      } else {
        let leaderUser = project.members.find(m => m.userId === leaderId)?.user;
        if (!leaderUser) {
          leaderUser = await prisma.user.findUnique({
            where: { id: leaderId },
            select: { id: true, name: true, email: true, globalRole: true, designation: true, profilePic: true }
          });
        }
        if (leaderUser) {
          leaderObj = {
            id: leaderUser.id,
            name: leaderUser.name,
            email: leaderUser.email,
            globalRole: leaderUser.globalRole,
            designation: leaderUser.designation,
            profilePic: leaderUser.profilePic
          };
          filteredMembers = membersReport.filter(m => m.teamLeaderId === leaderUser.id || (m.teamLeaderId == null && m.designation === leaderUser.designation));
        }
      }
    } else if (req.user.globalRole === 'ADMIN') {
      // For Admin main report: Show only Team Leaders with aggregated Squad Stats
      const leaders = membersReport.filter(m => m.role === 'TEAM_LEADER');
      
      const realLeaderDesignations = new Set(leaders.map(l => l.designation));
      // Only create generic squads for actual MEMBERs who DO NOT have a teamLeaderId
      const membersWithoutLeader = membersReport.filter(m => m.role === 'MEMBER' && m.teamLeaderId == null);
      const designationsInProject = [...new Set(membersWithoutLeader.map(m => m.designation).filter(Boolean))];
      const noLeaderDesignations = designationsInProject.filter(d => !realLeaderDesignations.has(d));
      
      const aggregatedLeaders = leaders.map(leader => {
        const squadMembers = membersReport.filter(m => m.teamLeaderId === leader.id || (m.teamLeaderId == null && m.designation === leader.designation));
        const squadTaskCount = squadMembers.reduce((sum, m) => sum + m.taskCount, 0);
        const squadCompleted = squadMembers.reduce((sum, m) => sum + m.completedTasks, 0);
        const squadHours = squadMembers.reduce((sum, m) => sum + m.totalHours, 0);
        
        return {
          ...leader,
          name: `${leader.name}'s Squad`,
          isAggregated: true,
          taskCount: squadTaskCount,
          completedTasks: squadCompleted,
          totalHours: squadHours,
          memberCount: squadMembers.length
        };
      });

      const virtualLeaders = noLeaderDesignations.map(d => {
        const squadMembers = membersReport.filter(m => m.designation === d && m.teamLeaderId == null);
        const squadTaskCount = squadMembers.reduce((sum, m) => sum + m.taskCount, 0);
        const squadCompleted = squadMembers.reduce((sum, m) => sum + m.completedTasks, 0);
        const squadHours = squadMembers.reduce((sum, m) => sum + m.totalHours, 0);
        
        return {
          id: `no-leader-${d}`,
          name: `${d} Squad`,
          email: 'No Team Leader assigned yet',
          role: 'TEAM_LEADER',
          designation: d,
          isAggregated: true,
          taskCount: squadTaskCount,
          completedTasks: squadCompleted,
          totalHours: squadHours,
          memberCount: squadMembers.length,
          hasNoLeader: true
        };
      });

      filteredMembers = [...aggregatedLeaders, ...virtualLeaders];
    }
    
    res.json({ project, members: filteredMembers, leader: leaderObj });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getGlobalReport = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const isAdmin = req.user.globalRole === 'ADMIN';
    const isTL = req.user.globalRole === 'TEAM_LEADER';

    if (!isAdmin && !isTL) {
      return res.status(403).json({ error: 'Access denied. Admin or Team Leader required.' });
    }

    const tzOffset = req.query.tzOffset ? parseInt(req.query.tzOffset, 10) : 0;

    // Determine date range
    let dateFilter = {};
    if (startDate && endDate) {
      dateFilter = { gte: new Date(startDate), lte: new Date(endDate) };
    }

    // For TL: get team user IDs
    let teamUserIds = [];
    if (isTL && !isAdmin) {
      const team = await prisma.user.findMany({
        where: {
          OR: [
            { id: req.user.id },
            { teamLeaderId: req.user.id },
            { AND: [{ teamLeaderId: null }, { designation: req.user.designation }] }
          ]
        },
        select: { id: true }
      });
      teamUserIds = team.map(u => u.id);
    }

    // Fetch all projects (for TL, only projects they are member of)
    let projectWhere = { workspaceId: req.user.primaryWorkspaceId };
    if (isTL && !isAdmin) {
      projectWhere.members = { some: { userId: { in: teamUserIds } } };
    }

    const projects = await prisma.project.findMany({
      where: projectWhere,
      include: {
        tasks: {
          include: {
            assignee: { select: { id: true, name: true, email: true, designation: true, globalRole: true, profilePic: true } },
            timeLogs: true,
            project: { select: { name: true } }
          }
        },
        members: {
          include: {
            user: { select: { id: true, name: true, email: true, designation: true, globalRole: true, profilePic: true } }
          }
        }
      }
    });

    // Build per-project summary
    const projectSummaries = projects.map(project => {
      let tasks = project.tasks;

      // TL filter: only their team's tasks
      if (isTL && !isAdmin) {
        tasks = tasks.filter(t => teamUserIds.includes(t.assigneeId));
      }

      // Apply date filter
      let completedTasks = tasks.filter(t => t.status === 'DONE');
      if (dateFilter.gte && dateFilter.lte) {
        completedTasks = completedTasks.filter(t => t.updatedAt >= dateFilter.gte && t.updatedAt <= dateFilter.lte);
      }

      const pendingTasks = tasks.filter(t => t.status === 'TODO');
      const progressTasks = tasks.filter(t => t.status === 'PROGRESS');
      const stuckTasks = tasks.filter(t => t.status === 'STUCK');
      const holdTasks = tasks.filter(t => t.status === 'HOLD');
      const overdueTasks = tasks.filter(t => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'DONE');

      // Calculate total hours
      let totalHours = 0;
      tasks.forEach(t => {
        t.timeLogs.forEach(log => {
          if (isTL && !isAdmin && !teamUserIds.includes(log.userId)) return;
          if (dateFilter.gte && dateFilter.lte) {
            const logDate = new Date(log.loggedAt);
            if (logDate < dateFilter.gte || logDate > dateFilter.lte) return;
          }
          totalHours += log.hours;
        });
      });

      // Member count
      let memberCount = project.members.length;
      if (isTL && !isAdmin) {
        memberCount = project.members.filter(m => teamUserIds.includes(m.userId)).length;
      }

      return {
        id: project.id,
        name: project.name,
        totalTasks: tasks.length,
        completedCount: completedTasks.length,
        pendingCount: pendingTasks.length,
        progressCount: progressTasks.length,
        stuckCount: stuckTasks.length,
        holdCount: holdTasks.length,
        overdueCount: overdueTasks.length,
        totalHours: parseFloat(totalHours.toFixed(2)),
        memberCount,
        completionRate: tasks.length > 0 ? Math.round((completedTasks.length / tasks.length) * 100) : 0
      };
    });

    // Flatten all tasks across projects for detailed tables
    let allTasks = projects.flatMap(p => p.tasks);
    if (isTL && !isAdmin) {
      allTasks = allTasks.filter(t => teamUserIds.includes(t.assigneeId));
    }

    // Global completed tasks (within date range)
    let globalCompleted = allTasks.filter(t => t.status === 'DONE');
    if (dateFilter.gte && dateFilter.lte) {
      globalCompleted = globalCompleted.filter(t => t.updatedAt >= dateFilter.gte && t.updatedAt <= dateFilter.lte);
    }

    // Global pending
    const globalPending = allTasks.filter(t => t.status === 'TODO');

    // Global progress (current tasks)
    const globalProgress = allTasks.filter(t => t.status === 'PROGRESS' || t.status === 'TODO');

    // Global stuck
    const globalStuck = allTasks.filter(t => t.status === 'STUCK');

    // Global hold
    const globalHold = allTasks.filter(t => t.status === 'HOLD');

    // Global overdue
    const globalOverdue = allTasks
      .filter(t => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'DONE')
      .map(t => {
        const diffTime = Math.abs(new Date() - new Date(t.dueDate));
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return { ...t, daysOverdue: diffDays };
      })
      .sort((a, b) => b.daysOverdue - a.daysOverdue);

    // Global hours
    let globalTotalHours = 0;
    allTasks.forEach(t => {
      t.timeLogs.forEach(log => {
        if (isTL && !isAdmin && !teamUserIds.includes(log.userId)) return;
        if (dateFilter.gte && dateFilter.lte) {
          const logDate = new Date(log.loggedAt);
          if (logDate < dateFilter.gte || logDate > dateFilter.lte) return;
        }
        globalTotalHours += log.hours;
      });
    });

    // Completion trend (daily counts within date range)
    const dailyCounts = {};
    let trendStart = new Date();
    trendStart.setDate(trendStart.getDate() - 7);
    let trendEnd = new Date();
    if (dateFilter.gte && dateFilter.lte) {
      trendStart = new Date(dateFilter.gte);
      trendEnd = new Date(dateFilter.lte);
    }
    let currentLocal = new Date(trendStart.getTime() - tzOffset * 60 * 1000);
    currentLocal.setUTCHours(0, 0, 0, 0);
    const endLocal = new Date(trendEnd.getTime() - tzOffset * 60 * 1000);
    endLocal.setUTCHours(0, 0, 0, 0);
    while (currentLocal <= endLocal) {
      dailyCounts[currentLocal.toISOString().split('T')[0]] = 0;
      currentLocal.setUTCDate(currentLocal.getUTCDate() + 1);
    }
    globalCompleted.forEach(t => {
      const day = new Date(t.updatedAt.getTime() - tzOffset * 60 * 1000).toISOString().split('T')[0];
      if (dailyCounts[day] !== undefined) dailyCounts[day]++;
    });
    const completionTrend = Object.keys(dailyCounts).map(date => ({ date, count: dailyCounts[date] }));

    // Member performance aggregation across all projects
    const memberMap = {};
    projects.forEach(project => {
      project.members.forEach(pm => {
        if (isTL && !isAdmin && !teamUserIds.includes(pm.userId)) return;
        if (!memberMap[pm.userId]) {
          memberMap[pm.userId] = {
            id: pm.user.id,
            name: pm.user.name,
            email: pm.user.email,
            designation: pm.user.designation,
            role: pm.user.globalRole,
            profilePic: pm.user.profilePic,
            totalTasks: 0,
            completedTasks: 0,
            totalHours: 0,
            projectCount: 0,
            projectNames: []
          };
        }
        memberMap[pm.userId].projectCount++;
        if (project.name && !memberMap[pm.userId].projectNames.includes(project.name)) {
          memberMap[pm.userId].projectNames.push(project.name);
        }
      });
    });

    allTasks.forEach(t => {
      if (!t.assigneeId || !memberMap[t.assigneeId]) return;
      memberMap[t.assigneeId].totalTasks++;
      if (t.status === 'DONE') memberMap[t.assigneeId].completedTasks++;
      t.timeLogs.forEach(log => {
        if (log.userId !== t.assigneeId) return;
        if (dateFilter.gte && dateFilter.lte) {
          const logDate = new Date(log.loggedAt);
          if (logDate < dateFilter.gte || logDate > dateFilter.lte) return;
        }
        memberMap[t.assigneeId].totalHours += log.hours;
      });
    });

    const memberPerformance = Object.values(memberMap).sort((a, b) => b.completedTasks - a.completedTasks);

    res.json({
      projectSummaries,
      globalStats: {
        totalProjects: projects.length,
        totalCompleted: globalCompleted.length,
        totalPending: globalPending.length,
        totalStuck: globalStuck.length,
        totalHold: globalHold.length,
        totalOverdue: globalOverdue.length,
        totalHours: parseFloat(globalTotalHours.toFixed(2))
      },
      completionTrend,
      completedTasks: globalCompleted,
      pendingTasks: globalPending,
      stuckTasks: globalStuck,
      holdTasks: globalHold,
      overdueTasks: globalOverdue,
      memberPerformance
    });
  } catch (error) {
    console.error('Global report error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getHistory = async (req, res) => {
  try {
    const { projectId, targetUserId, startDate, endDate, leaderId } = req.query;
    const isAdmin = req.user.globalRole === 'ADMIN';
    const isTL = req.user.globalRole === 'TEAM_LEADER';
    const isManager = req.user.globalRole === 'MANAGER';

    let effectiveUserId = req.user.id;
    if (targetUserId && (isAdmin || isManager || isTL)) {
      if (isTL && !isAdmin) {
        const target = await prisma.user.findUnique({ where: { id: targetUserId } });
        if (target && (target.teamLeaderId === req.user.id || target.designation === req.user.designation)) {
          effectiveUserId = targetUserId;
        }
      } else {
        effectiveUserId = targetUserId;
      }
    }

    const isPersonalScope = req.query.personal === 'true';
    const showTeamData = isTL && !targetUserId && !isAdmin && !isManager && !isPersonalScope;
    const isPersonal = !isAdmin && !isManager && (!isTL || effectiveUserId === req.user.id || isPersonalScope) && !showTeamData;
    const squadUserIds = isAdmin ? await getAdminSquadIds(leaderId, prisma) : null;

    let whereClause = {
      status: 'DONE',
      project: { workspaceId: req.user.primaryWorkspaceId }
    };
    if (projectId) whereClause.projectId = projectId;
    
    if (startDate && endDate) {
      whereClause.updatedAt = { gte: new Date(startDate), lte: new Date(endDate) };
    }
    
    if (showTeamData) {
      whereClause.assignee = {
        OR: [
          { id: req.user.id },
          {
            AND: [
              { globalRole: 'MEMBER' },
              {
                OR: [
                  { teamLeaderId: req.user.id },
                  { AND: [{ teamLeaderId: null }, { designation: req.user.designation }] }
                ]
              }
            ]
          }
        ]
      };
    } else if (isPersonal || targetUserId) {
      whereClause.assigneeId = effectiveUserId;
    } else if (squadUserIds !== null) {
      whereClause.assigneeId = { in: squadUserIds };
    }

    const tasks = await prisma.task.findMany({
      where: whereClause,
      include: { 
        assignee: true,
        project: { select: { name: true } }
      },
      orderBy: { updatedAt: 'desc' }
    });

    res.json(tasks);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};
