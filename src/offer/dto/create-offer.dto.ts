import { ApiProperty } from '@nestjs/swagger'
import { CattlePurpose, CattleType, PriceType } from '@prisma/client'
import {
	IsBoolean,
	IsEnum,
	IsNumber,
	IsOptional,
	IsString,
	Max,
	Min,
} from 'class-validator'

export class CreateOfferDto {
	@ApiProperty({ description: 'Заголовок объявления' })
	@IsString()
	title: string

	@ApiProperty({ description: 'Описание объявления', required: false })
	@IsOptional()
	@IsString()
	description?: string

	@ApiProperty({ description: 'Количество голов' })
	@IsNumber()
	@Min(1)
	quantity: number

	@ApiProperty({ description: 'Вес в кг', required: false })
	@IsOptional()
	@IsNumber()
	@Min(0)
	weight?: number

	@ApiProperty({ description: 'Возраст в месяцах', required: false })
	@IsOptional()
	@IsNumber()
	@Min(0)
	age?: number

	@ApiProperty({ description: 'Цена', required: false })
	@IsOptional()
	@IsNumber()
	@Min(0)
	price?: number

	@ApiProperty({
		description: 'Тип цены',
		enum: PriceType,
		default: 'PER_HEAD',
	})
	@IsEnum(PriceType)
	@IsOptional()
	priceType?: PriceType

	@ApiProperty({ description: 'Цена за кг', required: false })
	@IsOptional()
	@IsNumber()
	@Min(0)
	pricePerKg?: number

	@ApiProperty({ description: 'Цена за голову', required: false })
	@IsOptional()
	@IsNumber()
	@Min(0)
	pricePerHead?: number

	@ApiProperty({ description: 'Скидка на ливер в процентах', required: false })
	@IsOptional()
	@IsNumber()
	@Min(0)
	@Max(100)
	gktDiscount?: number

	@ApiProperty({ description: 'Локация', required: false })
	@IsOptional()
	@IsString()
	location?: string

	@ApiProperty({ description: 'Регион', required: false })
	@IsOptional()
	@IsString()
	region?: string

	@ApiProperty({ description: 'Полный адрес', required: false })
	@IsOptional()
	@IsString()
	fullAddress?: string

	@ApiProperty({ description: 'Состоит в Реестре ТС', required: false })
	@IsOptional()
	@IsBoolean()
	customsUnion?: boolean

	@ApiProperty({ description: 'Порода', required: false })
	@IsOptional()
	@IsString()
	breed?: string

	@ApiProperty({ description: 'Тип КРС', enum: CattleType, required: false })
	@IsOptional()
	@IsEnum(CattleType)
	cattleType?: CattleType

	@ApiProperty({
		description: 'Назначение',
		enum: CattlePurpose,
		required: false,
	})
	@IsOptional()
	@IsEnum(CattlePurpose)
	purpose?: CattlePurpose

	@ApiProperty({ description: 'Номер в системе Меркурий', required: false })
	@IsOptional()
	@IsString()
	mercuryNumber?: string

	@ApiProperty({ description: 'Контактное лицо', required: false })
	@IsOptional()
	@IsString()
	contactPerson?: string

	@ApiProperty({ description: 'Контактный телефон', required: false })
	@IsOptional()
	@IsString()
	contactPhone?: string

	@ApiProperty({ description: 'Ссылка на видео', required: false })
	@IsOptional()
	@IsString()
	videoUrl?: string
}
