import {
	DeleteObjectCommand,
	ObjectCannedACL,
	PutObjectCommand,
	S3,
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
	private s3: S3

	constructor(private readonly configService: ConfigService) {
		this.s3 = new S3({
			endpoint: 'https://storage.yandexcloud.net',
			region: 'ru-central1',
			credentials: {
				accessKeyId: this.configService.get('YC_ACCESS_KEY_ID'),
				secretAccessKey: this.configService.get('YC_SECRET_ACCESS_KEY'),
			},
		})
	}

	async uploadFile(file: UploadedFile): Promise<{ url: string; key: string }> {
		const key = `offers/${uuidv4()}-${file.originalname}`

		const params = {
			Bucket: this.configService.get('YC_BUCKET_NAME'),
			Key: key,
			Body: file.buffer,
			ContentType: file.mimetype,
			ACL: ObjectCannedACL.public_read,
		}

		await this.s3.send(new PutObjectCommand(params))

		const url = `https://${this.configService.get(
			'YC_BUCKET_NAME',
		)}.storage.yandexcloud.net/${key}`

		return {
			url,
			key,
		}
	}

	async deleteFile(key: string) {
		const params = {
			Bucket: this.configService.get('YC_BUCKET_NAME'),
			Key: key,
		}

		await this.s3.send(new DeleteObjectCommand(params))
	}
}
