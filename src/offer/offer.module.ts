import { S3Service } from '@/common/services/s3.service'
import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../prisma.service'
import { TelegramClient } from '../telegram/telegram.client'
import { OfferController } from './offer.controller'
import { OfferService } from './offer.service'
@Module({
	controllers: [OfferController],
	providers: [
		OfferService,
		PrismaService,
		TelegramClient,
		S3Service,
		ConfigService,
	],
	exports: [OfferService],
})
export class OfferModule {}
