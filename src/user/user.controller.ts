import {
	Body,
	Controller,
	Get,
	HttpCode,
	Param,
	Put,
	UsePipes,
	ValidationPipe,
} from '@nestjs/common'
import { Auth } from '../auth/decorators/auth.decorator'
import { CurrentUser } from '../auth/decorators/user.decorator'
import { UserDto } from './user.dto'
import { UserService } from './user.service'

@Controller('users')
export class UserController {
	constructor(private readonly userService: UserService) {}

	@Get('profile')
	@Auth('user')
	async getProfile(@CurrentUser('id') id: string) {
		return this.userService.byId(id)
	}

	@UsePipes(new ValidationPipe())
	@Auth('user')
	@HttpCode(200)
	@Put('profile')
	async getNewToken(@CurrentUser('id') id: string, @Body() dto: UserDto) {
		return this.userService.updateProfile(id, dto)
	}

	@Get('pending')
	@Auth('ADMIN')
	async getPendingUsers() {
		return this.userService.getPendingUsers()
	}

	@Put('verify/:id')
	@Auth('ADMIN')
	async verifyUser(
		@Param('id') id: string,
		@Body() { status }: { status: 'APPROVED' | 'REJECTED' },
	) {
		return this.userService.verifyUser(id, status)
	}
}
