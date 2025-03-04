import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { AuthModule } from './auth/auth.module'
import { JwtStrategy } from './auth/jwt.strategy'
import { S3Service } from './common/services/s3.service'
import { PrismaService } from './prisma.service'
import { CozeService } from './services/coze.service'
import { TelegramModule } from './telegram/telegram.module'
import { UserModule } from './user/user.module'

@Module({
	imports: [ConfigModule.forRoot(), AuthModule, UserModule, TelegramModule],
	providers: [
		PrismaService,
		{
			provide: S3Service,
			useFactory: (config: ConfigService) => new S3Service(config),
			inject: [ConfigService],
		},
		JwtStrategy,
		CozeService,
	],
})
export class AppModule {}
