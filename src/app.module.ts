import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { ScheduleModule } from '@nestjs/schedule'
import { AuthModule } from './auth/auth.module'
import { JwtStrategy } from './auth/jwt.strategy'
import { S3Service } from './common/services/s3.service'
import { PrismaService } from './prisma.service'
import { AiAnalysisService } from './services/ai-analysis.service'
import { CozeService } from './services/coze.service'
import { TelegramModule } from './telegram/telegram.module'
import { UserModule } from './user/user.module'

@Module({
	imports: [
		ConfigModule.forRoot(),
		ScheduleModule.forRoot(),
		AuthModule,
		UserModule,
		TelegramModule,
	],
	providers: [
		PrismaService,
		{
			provide: S3Service,
			useFactory: (config: ConfigService) => new S3Service(config),
			inject: [ConfigService],
		},
		JwtStrategy,
		CozeService,
		AiAnalysisService,
	],
})
export class AppModule {}
