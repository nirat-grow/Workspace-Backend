const prisma = require('./src/config/db');

async function test() {
  try {
    console.log('Testing DB connection...');
    const users = await prisma.user.findMany({ take: 1 });
    console.log('Users found:', users.length);

    if (users.length === 0) {
      console.log('No users found. Creating a test user...');
      // ... skipping user creation for now
    }

    const projectMembers = await prisma.projectMember.findMany({
      include: { user: true, project: true }
    });
    console.log('--- PROJECT MEMBERS ---');
    projectMembers.forEach(pm => {
      console.log(`User: ${pm.user.name} is in Project: ${pm.project.name} (Can Create Task: ${pm.canCreateTask})`);
    });

  } catch (err) {
    console.error('DATABASE ERROR:', err);
  } finally {
    await prisma.$disconnect();
  }
}

test();
