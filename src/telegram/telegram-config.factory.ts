import { ConfigService } from '@nestjs/config'
import {
	TelegrafModuleAsyncOptions,
	TelegrafModuleOptions,
} from 'nestjs-telegraf'
import * as LocalSession from 'telegraf-session-local'

const sessions = new LocalSession()

const telegrafModuleOptions = (
	config: ConfigService,
): TelegrafModuleOptions => {
	return {
		middlewares: [sessions.middleware()],
		token: config.get('BOT_TOKEN'),
		launchOptions: {
			dropPendingUpdates: true,
		},
	}
}

export const options = (): TelegrafModuleAsyncOptions => {
	return {
		inject: [ConfigService],
		useFactory: (config: ConfigService) => telegrafModuleOptions(config),
	}
}
