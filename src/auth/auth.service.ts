import {
	BadRequestException,
	ForbiddenException,
	Injectable,
	NotFoundException,
	UnauthorizedException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { User } from '@prisma/client'
import * as bcrypt from 'bcrypt'
import { Context } from 'telegraf'
import { PrismaService } from '../prisma.service'
import { UserService } from '../user/user.service'
import { AuthDto } from './dto/auth.dto'

@Injectable()
export class AuthService {
	private loginStates: Map<number, { email?: string; password?: string }> =
		new Map()

	constructor(
		private prisma: PrismaService,
		private jwtService: JwtService,
		private userService: UserService,
	) {}

	async register(dto: AuthDto & { telegramId?: string }) {
		const existUser = await this.prisma.user.findUnique({
			where: { email: dto.email },
		})

		if (existUser) {
			throw new BadRequestException('Пользователь уже существует')
		}

		const user = await this.prisma.user.create({
			data: {
				email: dto.email,
				name: dto.name,
				phone: dto.phone,
				address: dto.address,
				password: await bcrypt.hash(dto.password, 5),
				role: dto.role || 'BUYER',
				isVerified: false,
				telegramId: dto.telegramId,
			},
		})

		return {
			user: this.returnUserFields(user),
			message: 'Регистрация успешна. Ожидайте подтверждения администратором.',
		}
	}

	private async issueTokens(userId: string) {
		const data = { id: userId }

		const accessToken = await this.jwtService.signAsync(data, {
			expiresIn: '1h',
		})

		const refreshToken = await this.jwtService.signAsync(data, {
			expiresIn: '7d',
		})
		return { accessToken, refreshToken }
	}

	private returnUserFields(user: User) {
		return {
			id: user.id,
			email: user.email,
			name: user.name,
			role: user.role,
			isAdmin: user.isAdmin,
		}
	}

	async login(loginDto: { email: string; password: string }) {
		const user = await this.prisma.user.findUnique({
			where: { email: loginDto.email },
		})

		if (!user) {
			throw new NotFoundException('Пользователь не найден')
		}

		if (!user.isVerified) {
			throw new ForbiddenException(
				'Аккаунт ожидает подтверждения администратором',
			)
		}

		const isPasswordValid = await bcrypt.compare(
			loginDto.password,
			user.password,
		)
		if (!isPasswordValid) {
			throw new UnauthorizedException('Неверный пароль')
		}

		// Генерируем токены
		const tokens = await this.issueTokens(user.id)

		return {
			user: this.returnUserFields(user),
			...tokens, // Возвращаем accessToken и refreshToken
		}
	}

	async getNewTokens(refreshToken: string) {
		const result = await this.jwtService.verifyAsync(refreshToken)
		if (!result) throw new UnauthorizedException('Invalid refresh token')

		const user = await this.prisma.user.findUnique({
			where: { id: result.id },
		})
		const tokens = await this.userService.byId(result.id, {
			isAdmin: true,
		})
		return {
			user: this.returnUserFields(user),
			...tokens,
		}
	}

	private async validateUser(dto: AuthDto) {
		const user = await this.prisma.user.findUnique({
			where: {
				email: dto.email,
			},
		})

		if (!user) throw new NotFoundException('User not found')

		const isValidPassword = await bcrypt.compare(dto.password, user.password)
		if (!isValidPassword) throw new UnauthorizedException('Invalid password')

		if (!user.isVerified) {
			throw new ForbiddenException('Account is not verified')
		}

		return user
	}

	// Добавляем метод для получения состояния входа
	getLoginState(userId: number) {
		return this.loginStates.get(userId)
	}

	// Добавляем метод инициализации состояния входа
	async initLoginState(userId: number) {
		console.log('Инициализация состояния входа для пользователя:', userId)
		this.loginStates.set(userId, {})
	}

	// Обновляем метод handleLoginInput
	async handleLoginInput(ctx: Context, text: string) {
		console.log('Вход в handleLoginInput:', text)
		const userId = ctx.from.id
		const loginState = this.loginStates.get(userId)
		console.log('Текущее состояние входа:', loginState)

		if (!loginState) {
			await ctx.reply('❌ Сессия входа истекла. Пожалуйста, начните заново.')
			return
		}

		if (!loginState.email) {
			if (!this.validateEmail(text)) {
				await ctx.reply('❌ Неверный формат email. Попробуйте еще раз.')
				return
			}
			loginState.email = text
			this.loginStates.set(userId, loginState)
			console.log('Email сохранен:', loginState)
			await ctx.reply('🔑 Введите пароль:')
			return
		}

		if (!loginState.password) {
			try {
				const result = await this.login({
					email: loginState.email,
					password: text,
				})

				if (result.accessToken) {
					await ctx.reply('✅ Вход выполнен успешно!')
					// Обновляем telegramId пользователя
					await this.prisma.user.update({
						where: { email: loginState.email },
						data: { telegramId: userId.toString() },
					})
				} else {
					await ctx.reply('❌ Неверный email или пароль')
				}
			} catch (error) {
				await ctx.reply('❌ Неверный email или пароль')
			} finally {
				this.loginStates.delete(userId)
			}
		}
	}

	private validateEmail(email: string): boolean {
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
		return emailRegex.test(email)
	}
}
