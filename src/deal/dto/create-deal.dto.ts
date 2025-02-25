import { ApiProperty } from '@nestjs/swagger'
import { IsNotEmpty, IsNumber, IsPositive, IsUUID } from 'class-validator'

export class CreateDealDto {
	@ApiProperty({ description: 'ID объявления' })
	@IsUUID()
	@IsNotEmpty()
	offerId: string

	@ApiProperty({ description: 'ID покупателя' })
	@IsUUID()
	@IsNotEmpty()
	buyerId: string

	@ApiProperty({ description: 'ID продавца' })
	@IsUUID()
	@IsNotEmpty()
	sellerId: string

	@ApiProperty({ description: 'Цена' })
	@IsNumber()
	@IsPositive()
	price: number

	@ApiProperty({ description: 'Количество' })
	@IsNumber()
	@IsPositive()
	quantity: number
}
