import { ApiProperty } from '@nestjs/swagger'
import { IsEnum, IsNumber, IsOptional, IsPositive } from 'class-validator'

export class UpdateDealDto {
	@ApiProperty({
		description: 'Статус сделки',
		enum: ['PENDING', 'APPROVED', 'REJECTED'],
	})
	@IsEnum(['PENDING', 'APPROVED', 'REJECTED'])
	@IsOptional()
	status?: 'PENDING' | 'APPROVED' | 'REJECTED'

	@ApiProperty({ description: 'Цена' })
	@IsNumber()
	@IsPositive()
	@IsOptional()
	price?: number

	@ApiProperty({ description: 'Количество' })
	@IsNumber()
	@IsPositive()
	@IsOptional()
	quantity?: number
}
