import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import * as process from 'process'
import { AppModule } from './app.module'

async function bootstrap() {
	const app = await NestFactory.create(AppModule)

	app.setGlobalPrefix('api')
	app.useGlobalPipes(new ValidationPipe())

	app.enableCors()

	await app.listen(process.env.PORT || 6060)
}
bootstrap()
