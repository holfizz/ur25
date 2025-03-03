import { MailService } from '@/auth/mail.service'
import { PrismaService } from '@/prisma.service'
import { TelegramModule } from '@/telegram/telegram.module'
import { forwardRef, Module } from '@nestjs/common'
import { UserController } from './user.controller'
import { UserService } from './user.service'

@Module({
	imports: [forwardRef(() => TelegramModule)],
	controllers: [UserController],
	providers: [UserService, PrismaService, MailService],
	exports: [UserService],
})
export class UserModule {}
