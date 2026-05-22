const prisma = require('../config/db');
const bcrypt = require('bcrypt');
const { generateToken } = require('../utils/jwt.util');
const emailService = require('../services/email.service');


exports.createFirstAdmin = async (req, res) => {
  try {
    const { name, email, password, adminSecret, telegramId } = req.body;
    
    if (adminSecret !== 'Meta123') {
      return res.status(403).json({ error: 'Invalid Secret Code. You cannot create an Admin account.' });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { name, email, password: hashedPassword, globalRole: 'ADMIN', telegramId: telegramId || null }
      });
      
      const workspace = await tx.workspace.create({
        data: { name: `${name}'s Workspace` }
      });
      
      await tx.workspaceMember.create({
        data: { workspaceId: workspace.id, userId: user.id, role: 'ADMIN' }
      });
      
      return user;
    });

    const token = generateToken(result.id);
    const userWithWorkspaces = await prisma.user.findUnique({
      where: { id: result.id },
      include: { workspaces: true }
    });
    res.status(201).json({ token, user: userWithWorkspaces });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

exports.register = async (req, res) => {
  try {
    const { token, name, password, telegramId } = req.body;
    
    const invite = await prisma.invite.findUnique({
      where: { token },
      include: { workspace: true }
    });

    if (!invite || invite.used || new Date() > invite.expiresAt) {
      return res.status(400).json({ error: 'Invalid or expired invite token' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name,
          email: invite.email,
          password: hashedPassword,
          globalRole: invite.role,
          designation: req.body.designation, // Save designation
          telegramId: telegramId || null
        }
      });

      await tx.workspaceMember.create({
        data: {
          workspaceId: invite.workspaceId,
          userId: user.id,
          role: invite.role
        }
      });

      await tx.invite.update({
        where: { id: invite.id },
        data: { used: true }
      });

      return user;
    });

    const jwtToken = generateToken(result.id);
    res.status(201).json({ token: jwtToken, user: { id: result.id, name: result.name, email: result.email, globalRole: result.globalRole, designation: result.designation, telegramId: result.telegramId, profilePic: result.profilePic } });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'Email already registered' });
    }
    res.status(500).json({ error: 'Server error' });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(user.id);
    const userWithWorkspaces = await prisma.user.findUnique({
      where: { id: user.id },
      include: { workspaces: true }
    });
    res.json({ token, user: { ...userWithWorkspaces, designation: userWithWorkspaces.designation, telegramId: userWithWorkspaces.telegramId } });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getMe = async (req, res) => {
  try {
    // Automatically ensure Jems has 'Flutter' designation in the database if not set
    await prisma.user.updateMany({
      where: { name: 'Jems', OR: [{ designation: null }, { designation: '' }] },
      data: { designation: 'Flutter' }
    });

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { workspaces: true }
    });
    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        globalRole: user.globalRole,
        designation: user.designation,
        telegramId: user.telegramId,
        profilePic: user.profilePic,
        workspaces: user.workspaces
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

// Update user's global role (Admin only)
exports.updateUserRole = async (req, res) => {
  try {
    if (req.user.globalRole !== 'ADMIN') {
      return res.status(403).json({ error: 'Only admins can change roles' });
    }

    const { id } = req.params;
    const { globalRole } = req.body;

    const validRoles = ['ADMIN', 'TEAM_LEADER', 'MANAGER', 'MEMBER'];
    if (!validRoles.includes(globalRole)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const targetUser = await prisma.user.findUnique({ where: { id } });
    if (!targetUser) return res.status(404).json({ error: 'User not found' });

    // Update global role
    const updated = await prisma.user.update({
      where: { id },
      data: { globalRole },
      select: { id: true, name: true, email: true, globalRole: true }
    });

    // Sync project member permissions
    const canCreateAssign = ['ADMIN', 'TEAM_LEADER'].includes(globalRole);
    await prisma.projectMember.updateMany({
      where: { userId: id },
      data: {
        canCreateTask: canCreateAssign,
        canAssignTask: canCreateAssign
      }
    });

    res.json(updated);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Admin assigning a team leader to a member (or TL removing their own member)
exports.assignTeamLeader = async (req, res) => {
  try {
    const { id } = req.params; // Member ID
    const { teamLeaderId } = req.body;

    const targetUser = await prisma.user.findUnique({ where: { id } });
    if (!targetUser) return res.status(404).json({ error: 'User not found' });

    // Permissions check
    if (req.user.globalRole !== 'ADMIN') {
      const isAssigningToSelf = teamLeaderId === req.user.id;
      const isTheirLeader = targetUser.teamLeaderId === req.user.id;
      const isRemoving = teamLeaderId === null;

      if (req.user.globalRole !== 'TEAM_LEADER' || (!isAssigningToSelf && !(isTheirLeader && isRemoving))) {
        return res.status(403).json({ error: 'Permission denied. You can only add members to your own team or remove your own team members.' });
      }
    }

    if (teamLeaderId) {
      const leaderUser = await prisma.user.findUnique({ where: { id: teamLeaderId } });
      if (!leaderUser) return res.status(404).json({ error: 'Team Leader not found' });
      if (leaderUser.globalRole !== 'TEAM_LEADER' && leaderUser.globalRole !== 'ADMIN') {
        return res.status(400).json({ error: 'Target user is not a Team Leader' });
      }
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { teamLeaderId: teamLeaderId || null },
      select: { id: true, name: true, email: true, globalRole: true, teamLeaderId: true }
    });

    res.json(updated);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Team Leader fetching their team members
exports.getMyTeam = async (req, res) => {
  try {
    if (req.user.globalRole !== 'TEAM_LEADER' && req.user.globalRole !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const team = await prisma.user.findMany({
      where: {
        AND: [
          { globalRole: 'MEMBER' },
          { designation: req.user.designation }
        ]
      },
      select: { id: true, name: true, email: true, globalRole: true, designation: true, createdAt: true, profilePic: true }
    });

    res.json(team);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Admin fetching a specific team's members
exports.getSpecificTeam = async (req, res) => {
  try {
    if (req.user.globalRole !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { leaderId } = req.params;

    const leader = await prisma.user.findUnique({
      where: { id: leaderId },
      select: { id: true, name: true, email: true, globalRole: true }
    });

    if (!leader) return res.status(404).json({ error: 'Leader not found' });

    const team = await prisma.user.findMany({
      where: { teamLeaderId: leaderId },
      select: { id: true, name: true, email: true, globalRole: true, createdAt: true }
    });

    res.json({ leader, team });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, globalRole: true, designation: true, createdAt: true, profilePic: true }
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

exports.deleteUserGlobally = async (req, res) => {
  try {
    if (req.user.globalRole !== 'ADMIN') {
      return res.status(403).json({ error: 'Only admins can remove users globally' });
    }

    const { id } = req.params;
    if (id === req.user.id) {
      return res.status(400).json({ error: 'You cannot remove yourself globally' });
    }

    const targetUser = await prisma.user.findUnique({ where: { id } });
    if (!targetUser) return res.status(404).json({ error: 'User not found' });

    // Perform cascade delete / unassign in transaction
    await prisma.$transaction([
      // 1. Unassign tasks
      prisma.task.updateMany({
        where: { assigneeId: id },
        data: { assigneeId: null }
      }),
      // 2. Delete time logs
      prisma.timeLog.deleteMany({
        where: { userId: id }
      }),
      // 3. Delete comments
      prisma.comment.deleteMany({
        where: { authorId: id }
      }),
      // 4. Delete project membership
      prisma.projectMember.deleteMany({
        where: { userId: id }
      }),
      // 5. Delete workspace membership
      prisma.workspaceMember.deleteMany({
        where: { userId: id }
      }),
      // 6. Delete teamLeader associations (if they are teamLeader of someone else)
      prisma.user.updateMany({
        where: { teamLeaderId: id },
        data: { teamLeaderId: null }
      }),
      // 7. Finally delete the user
      prisma.user.delete({
        where: { id }
      })
    ]);

    res.json({ success: true, message: 'User globally removed successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const { name, designation, telegramId } = req.body;
    
    const updateData = { 
      name, 
      designation, 
      telegramId: telegramId || null 
    };

    if (req.file) {
      updateData.profilePic = `/uploads/${req.file.filename}`;
    } else if (req.body.profilePic === null || req.body.profilePic === '') {
      updateData.profilePic = null;
    }

    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: updateData,
      include: { workspaces: true }
    });

    res.json({
      user: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        globalRole: updated.globalRole,
        designation: updated.designation,
        telegramId: updated.telegramId,
        profilePic: updated.profilePic,
        workspaces: updated.workspaces
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

// In-memory store for reset password OTPs
const otpStore = new Map();

exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) {
      return res.status(404).json({ error: 'No account found with this email' });
    }

    // Generate secure 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes from now

    otpStore.set(email.toLowerCase(), { otp, expiresAt });

    // Send email
    const success = await emailService.sendOTPEmail(email, otp);
    if (!success) {
      return res.status(500).json({ error: 'Failed to send OTP email. Please try again.' });
    }

    res.json({ message: 'OTP sent successfully to your email.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) {
      return res.status(400).json({ error: 'Email, OTP, and new password are required' });
    }

    const record = otpStore.get(email.toLowerCase());
    if (!record) {
      return res.status(400).json({ error: 'OTP request not found or expired. Please request a new OTP.' });
    }

    if (record.otp !== otp) {
      return res.status(400).json({ error: 'Invalid OTP code. Please check and try again.' });
    }

    if (Date.now() > record.expiresAt) {
      otpStore.delete(email.toLowerCase());
      return res.status(400).json({ error: 'OTP code has expired. Please request a new one.' });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password in database
    await prisma.user.update({
      where: { email: email.toLowerCase() },
      data: { password: hashedPassword }
    });

    // Delete OTP from cache
    otpStore.delete(email.toLowerCase());

    res.json({ message: 'Password reset successfully. You can now login with your new password.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

