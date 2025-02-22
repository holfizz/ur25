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
import { PrismaService } from '../prisma.service'
import { UserService } from '../user/user.service'
import { AuthDto } from './dto/auth.dto'

@Injectable()
export class AuthService {
	constructor(
		private prisma: PrismaService,
		private jwtService: JwtService,
		private userService: UserService,
	) {}

	async register(dto: AuthDto) {
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
			},
		})

		const tokens = await this.issueTokens(user.id)

		return {
			user: this.returnUserFields(user),
			...tokens,
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

	async login(dto: AuthDto) {
		const user = await this.validateUser(dto)
		const tokens = await this.issueTokens(user.id)
		return {
			user: this.returnUserFields(user),
			...tokens,
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
}
