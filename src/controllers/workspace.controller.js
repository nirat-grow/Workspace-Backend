const prisma = require('../config/db');

exports.createWorkspace = async (req, res) => {
  try {
    if (req.user.globalRole !== 'ADMIN') {
      return res.status(403).json({ error: 'Only admins can create workspaces' });
    }

    const { name } = req.body;
    const result = await prisma.$transaction(async (tx) => {
      const workspace = await tx.workspace.create({
        data: { name }
      });
      await tx.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: req.user.id,
          role: 'ADMIN'
        }
      });
      return workspace;
    });

    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getWorkspace = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if user is member
    if (req.user.globalRole !== 'ADMIN') {
      const isMember = await prisma.workspaceMember.findFirst({
        where: { workspaceId: id, userId: req.user.id }
      });
      if (!isMember) return res.status(403).json({ error: 'Access denied' });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { id },
      include: {
        // Include members for Admin and Team Leaders (TL needs it to add their squad to projects)
        members: (req.user.globalRole === 'ADMIN' || req.user.globalRole === 'TEAM_LEADER') ? { 
          include: { 
            user: { 
              select: { id: true, name: true, email: true, globalRole: true, teamLeaderId: true, designation: true, profilePic: true } 
            } 
          } 
        } : false,
        projects: {
          where: req.user.globalRole === 'ADMIN' ? {} : {
            members: {
              some: { userId: req.user.id }
            }
          },
          include: {
            members: {
              include: {
                user: {
                  select: { id: true, name: true, email: true, globalRole: true, designation: true, profilePic: true }
                }
              }
            }
          }
        }
      }
    });

    if (!workspace) return res.status(404).json({ error: 'Workspace not found' });
    res.json(workspace);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.addMember = async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, role } = req.body;
    
    // Only ADMIN or workspace manager should do this, simplified to ADMIN
    if (req.user.globalRole !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const member = await prisma.workspaceMember.create({
      data: {
        workspaceId: id,
        userId,
        role
      }
    });

    res.status(201).json(member);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};
