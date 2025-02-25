import { CattlePurpose, CattleType, PriceType } from '@prisma/client'
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

	cattleType: CattleType
	purpose: CattlePurpose
	priceType: PriceType
	pricePerKg?: number
	pricePerHead?: number
	gktDiscount?: number
	region: string
	fullAddress: string
	customsUnion: boolean
	videoUrl?: string
	mercuryNumber?: string
	contactPerson?: string
	contactPhone?: string
}
