import { IsNumber, IsString, Min } from 'class-validator'

export class CreateOfferDto {
	@IsString()
	title: string

	@IsString()
	description: string

	@IsNumber()
	@Min(0)
	price: number

	@IsNumber()
	@Min(1)
	quantity: number

	@IsString()
	breed: string

	@IsNumber()
	@Min(0)
	age: number

	@IsNumber()
	@Min(0)
	weight: number

	@IsString()
	location: string
}
