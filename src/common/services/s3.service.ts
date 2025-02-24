import {
	DeleteObjectCommand,
	PutObjectCommand,
	S3Client,
} from '@aws-sdk/client-s3'
import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { v4 as uuidv4 } from 'uuid'

interface UploadedFile {
	buffer: Buffer
	originalname: string
	mimetype: string
	fieldname: string
	encoding: string
	size: number
}

@Injectable()
export class S3Service {
	private s3Client: S3Client

	constructor(private readonly configService: ConfigService) {
		this.s3Client = new S3Client({
			endpoint: 'https://storage.yandexcloud.net',
			region: 'ru-central1',
			credentials: {
				accessKeyId: this.configService.get<string>('YC_ACCESS_KEY_ID'),
				secretAccessKey: this.configService.get<string>('YC_SECRET_ACCESS_KEY'),
			},
			forcePathStyle: true,
		})
	}

	async uploadFile(file: UploadedFile): Promise<{ url: string; key: string }> {
		const key = `offers/${uuidv4()}-${file.originalname}`

		const command = new PutObjectCommand({
			Bucket: this.configService.get('YC_BUCKET_NAME'),
			Key: key,
			Body: file.buffer,
			ContentType: file.mimetype,
		})

		await this.s3Client.send(command)

		const url = `https://${this.configService.get(
			'YC_BUCKET_NAME',
		)}.storage.yandexcloud.net/${key}`

		return {
			url,
			key,
		}
	}

	async deleteFile(key: string) {
		const command = new DeleteObjectCommand({
			Bucket: this.configService.get('YC_BUCKET_NAME'),
			Key: key,
		})

		await this.s3Client.send(command)
	}

	async upload(
		file: Buffer,
		key: string,
		contentType: string,
	): Promise<{ url: string }> {
		const command = new PutObjectCommand({
			Bucket: this.configService.get('YC_BUCKET_NAME'),
			Key: key,
			Body: file,
			ContentType: contentType,
		})

		await this.s3Client.send(command)

		const url = `https://${this.configService.get(
			'YC_BUCKET_NAME',
		)}.storage.yandexcloud.net/${key}`

		return { url }
	}
}
