import {
	CattleType,
	OfferStatus,
	PriceType,
	PrismaClient,
} from '@prisma/client'
import * as bcrypt from 'bcrypt'
const prisma = new PrismaClient()

const userId = '5a9d0da9-82d7-4e60-9b5f-5fffae14a18e'

const cattleBreeds = [
	'Абердин-ангусская',
	'Герефордская',
	'Голштинская',
	'Симментальская',
	'Лимузинская',
	'Калмыцкая',
	'Казахская белоголовая',
	'Черно-пестрая',
]

const cattleTypes = [
	CattleType.CALVES,
	CattleType.BULL_CALVES,
	CattleType.HEIFERS,
	CattleType.BREEDING_HEIFERS,
	CattleType.BULLS,
	CattleType.COWS,
]

const regions = [
	'Алтайский край',
	'Башкортостан',
	'Татарстан',
	'Ставропольский край',
	'Краснодарский край',
	'Ростовская область',
	'Воронежская область',
	'Белгородская область',
]

async function main() {
	// Хешируем пароль
	const hashedPassword = await bcrypt.hash('password', 10)

	// Создаем базового пользователя если его нет
	await prisma.user.upsert({
		where: { id: userId },
		update: {},
		create: {
			id: userId,
			name: 'Test User',
			email: 'test@example.com',
			password: hashedPassword, // Используем хешированный пароль
			role: 'SUPPLIER',
		},
	})

	// Создаем 50 офферов
	for (let i = 0; i < 50; i++) {
		const priceType = Math.random() > 0.5 ? 'PER_HEAD' : ('PER_KG' as PriceType)
		const quantity = Math.floor(Math.random() * 100) + 10 // от 10 до 110 голов
		const weight = Math.floor(Math.random() * 400) + 100 // от 100 до 500 кг
		const age = Math.floor(Math.random() * 24) + 6 // от 6 до 30 месяцев

		const pricePerHead = Math.floor(Math.random() * 150000) + 50000 // от 50000 до 200000 руб/гол
		const pricePerKg = Math.floor(Math.random() * 300) + 200 // от 200 до 500 руб/кг

		const breed = cattleBreeds[Math.floor(Math.random() * cattleBreeds.length)]
		const region = regions[Math.floor(Math.random() * regions.length)]
		const cattleType =
			cattleTypes[Math.floor(Math.random() * cattleTypes.length)]

		// Определяем статус оффера
		const statusRandom = Math.random()
		const offerStatus =
			statusRandom > 0.9
				? OfferStatus.SUPER_PREMIUM
				: statusRandom > 0.7
					? OfferStatus.PREMIUM
					: OfferStatus.REGULAR

		const hasGktDiscount = Math.random() > 0.7
		const gktDiscount = hasGktDiscount ? Math.floor(Math.random() * 15) + 5 : 0 // от 5% до 20%

		await prisma.offer.create({
			data: {
				userId,
				title: `${breed} ${quantity} голов, ${weight}кг`,
				description: `Продаются ${quantity} голов КРС породы ${breed}. Средний вес ${weight}кг, возраст ${age} мес. ${hasGktDiscount ? `Скидка по ЖКТ ${gktDiscount}%` : ''}`,
				quantity,
				weight,
				age,
				breed,
				region,
				cattleType,
				priceType,
				pricePerHead: priceType === 'PER_HEAD' ? pricePerHead : null,
				pricePerKg: priceType === 'PER_KG' ? pricePerKg : null,
				status: 'APPROVED',
				offerStatus,
				gktDiscount,
				customsUnion: Math.random() > 0.8,
				quality: Math.random() * 100,
				aiScore: Math.random() * 100,
				images: {
					create: [
						{
							url: `https://example.com/cattle-${i + 1}.jpg`,
							key: `cattle-${i + 1}.jpg`,
						},
					],
				},
			},
		})
	}

	console.log('База данных успешно наполнена')
}

main()
	.catch(e => {
		console.error(e)
		process.exit(1)
	})
	.finally(async () => {
		await prisma.$disconnect()
	})
