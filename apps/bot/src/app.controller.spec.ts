import type { TestingModule } from '@nestjs/testing'
import { Test } from '@nestjs/testing'
import { AppController } from './app.controller'

describe('appController', () => {
  let appController: AppController

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
    }).compile()

    appController = app.get<AppController>(AppController)
  })

  it('returns health payload with ok status', () => {
    const payload = appController.health()
    expect(payload.status).toBe('ok')
    expect(payload.service).toBe('hibiki-bot')
  })
})
