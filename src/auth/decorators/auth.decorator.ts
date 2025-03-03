import { UseGuards } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { Roles } from '../roles.decorator'
import { RolesGuard } from '../roles.guard'

export function Auth(role: string) {
	return function (
		target: any,
		propertyKey: string,
		descriptor: PropertyDescriptor,
	) {
		Roles(role)(target, propertyKey, descriptor)
		UseGuards(AuthGuard('jwt'), RolesGuard)(target, propertyKey, descriptor)
	}
}
