import { JwtAuthGuard } from '@/auth/jwt-auth.guard'
import { Roles } from '@/auth/roles.decorator'
import { RolesGuard } from '@/auth/roles.guard'
import { PrismaService } from '@/prisma.service'
import {
	Body,
	Controller,
	HttpCode,
	HttpException,
	HttpStatus,
	Post,
	UseGuards,
	UsePipes,
	ValidationPipe,
} from '@nestjs/common'
import { ApiResponse, ApiTags } from '@nestjs/swagger'
import { TelegramService } from '../telegram/telegram.service'
import { AuthService } from './auth.service'
import { RefreshTokenDto } from './dto/refreshToken.dto'
import { MailService } from './mail.service'

@ApiTags('auth')
@Controller('auth')
export class AuthController {
	constructor(
		private readonly authService: AuthService,
		private readonly mailService: MailService,
		private readonly prisma: PrismaService,
		private readonly telegramService: TelegramService,
	) {}

	@UsePipes(new ValidationPipe())
	@HttpCode(200)
	@Post('register')
	async register(@Body() registerDto: any) {
		return this.authService.register(registerDto)
	}

	@UsePipes(new ValidationPipe())
	@HttpCode(200)
	@Post('login')
	@ApiResponse({ status: 200, description: 'Успешный вход.' })
	@ApiResponse({ status: 404, description: 'Пользователь не найден.' })
	async login(@Body() loginDto: { email: string; password: string }) {
		return this.authService.login(loginDto)
	}

	@UsePipes(new ValidationPipe())
	@HttpCode(200)
	@Post('login/access-token')
	async getNewTokens(@Body() dto: RefreshTokenDto) {
		return this.authService.getNewTokens(dto.refreshToken)
	}

	@UseGuards(JwtAuthGuard, RolesGuard)
	@Post('verify-user')
	@Roles('ADMIN')
	async verifyUser(@Body('userId') userId: string) {
		try {
			const user = await this.prisma.user.update({
				where: { id: userId },
				data: { isVerified: true },
			})

			// Отправляем email с уведомлением
			await this.mailService.sendVerificationEmail(user.email)

			// Отправляем уведомление в Telegram
			if (user.telegramId) {
				await this.telegramService.sendVerificationNotification(user.telegramId)
			}

			return {
				success: true,
				message: 'User verified successfully',
			}
		} catch (error) {
			throw new HttpException(
				'Failed to verify user',
				HttpStatus.INTERNAL_SERVER_ERROR,
			)
		}
	}
}
