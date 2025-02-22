import { TelegramService } from '@/telegram/telegram.service'
import { TelegramServiceClient } from '@/telegram/telegram.service.client'
import { MailerModule } from '@nestjs-modules/mailer'
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter'
import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { JwtModule } from '@nestjs/jwt'
import { join } from 'path'
import { getJwtConfig } from '../config/jwt.config'
import { PrismaService } from '../prisma.service'
import { UserModule } from '../user/user.module'
import { UserService } from '../user/user.service'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { JwtStrategy } from './jwt.strategy'
import { MailService } from './mail.service'

@Module({
	imports: [
		ConfigModule,
		JwtModule.registerAsync({
			imports: [ConfigModule],
			inject: [ConfigService],
			useFactory: getJwtConfig,
		}),
		MailerModule.forRootAsync({
			imports: [ConfigModule],
			inject: [ConfigService],
			useFactory: async (config: ConfigService) => ({
				transport: {
					host: config.get('SMTP_HOST'),
					port: parseInt(config.get('SMTP_PORT')),
					secure: false,
					auth: {
						user: config.get('SMTP_USER'),
						pass: config.get('SMTP_PASSWORD'),
					},
					tls: {
						rejectUnauthorized: false,
					},
				},
				defaults: {
					from: `"UR25" <${config.get('SMTP_USER')}>`,
				},
				template: {
					dir: join(__dirname, 'templates'),
					adapter: new HandlebarsAdapter(),
				},
			}),
		}),
		UserModule,
	],
	controllers: [AuthController],
	providers: [
		AuthService,
		PrismaService,
		JwtStrategy,
		ConfigService,
		UserService,
		MailService,
		TelegramService,
		TelegramServiceClient,
	],
})
export class AuthModule {}
