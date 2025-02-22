import { Role } from '@prisma/client'

export interface RegistrationState {
	role?: Role | null
	email?: string | null
	password?: string | null
	confirmPassword?: string | null
	name?: string | null
	phone?: string | null
	address?: string | null
	inn?: string | null
}
