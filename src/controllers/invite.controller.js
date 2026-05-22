const prisma = require('../config/db');
const emailService = require('../services/email.service');

exports.createInvite = async (req, res) => {
  try {
    const { email, role, workspaceId, message } = req.body;
    
    if (req.user.globalRole !== 'ADMIN') {
      return res.status(403).json({ error: 'Only admins can invite members' });
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiry

    const invite = await prisma.invite.create({
      data: {
        email,
        role,
        workspaceId,
        expiresAt
      },
      include: { workspace: true }
    });

    const link = `${process.env.FRONTEND_URL}/register?token=${invite.token}`;
    await emailService.sendInviteEmail(email, invite.workspace.name, link, message);

    res.status(201).json(invite);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

exports.validateInvite = async (req, res) => {
  try {
    const { token } = req.params;
    const invite = await prisma.invite.findUnique({
      where: { token },
      include: { workspace: true }
    });

    if (!invite) return res.status(404).json({ error: 'Invite not found' });
    if (invite.used) return res.status(400).json({ error: 'Invite already used' });
    if (new Date() > invite.expiresAt) return res.status(400).json({ error: 'Invite expired' });

    res.json(invite);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getInvites = async (req, res) => {
  try {
    if (req.user.globalRole !== 'ADMIN') {
      return res.status(403).json({ error: 'Only admins can view invitations' });
    }

    const { workspaceId } = req.query;
    if (!workspaceId) {
      return res.status(400).json({ error: 'workspaceId is required' });
    }

    const invites = await prisma.invite.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' }
    });

    res.json(invites);
  } catch (error) {
    console.error('getInvites error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};
