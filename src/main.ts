import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { AppModule } from './app.module'

async function bootstrap() {
	// Создаем основное HTTP приложение
	const app = await NestFactory.create(AppModule)

	// Настройка Swagger

	app.enableCors()

	app.setGlobalPrefix('api')

	app.useGlobalPipes(new ValidationPipe())
	const config = new DocumentBuilder()
		.setTitle('API для торговли КРС')
		.setDescription('Документация API для торговли крупным рогатым скотом')
		.setVersion('1.0')
		.addTag('auth')
		.build()
	const document = SwaggerModule.createDocument(app, config)
	SwaggerModule.setup('api/docs', app, document)
	const port = process.env.PORT || 6060

	await app.listen(port)
	console.log(`Application is running on: http://localhost:${port}`)
}

bootstrap()
