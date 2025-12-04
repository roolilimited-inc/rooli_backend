import { prisma } from './utils';
import * as argon2 from 'argon2';

export async function seedUsers() {
  const users = [
    { email: 'user1@example.com', password: 'Password123', firstName: 'John', lastName: 'Doe' },
    { email: 'user2@example.com', password: 'Password123', firstName: 'Anna', lastName: 'Lee' },
    { email: 'user3@example.com', password: 'Password123', firstName: 'Mike', lastName: 'Smith' },
    { email: 'user4@example.com', password: 'Password123', firstName: 'Sara', lastName: 'Brown' },
    { email: 'user5@example.com', password: 'Password123', firstName: 'David', lastName: 'Young' },
  ];

  for (const u of users) {
    const existing = await prisma.user.findUnique({
      where: { email: u.email },
    });

    if (!existing) {
      await prisma.user.create({
        data: {
          email: u.email,
          password: await argon2.hash(u.password),
          firstName: u.firstName,
          lastName: u.lastName,
        },
      });
    }
  }

  console.log('✔ Users seeded');
}