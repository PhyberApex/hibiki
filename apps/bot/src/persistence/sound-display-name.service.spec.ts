import type { TestingModule } from '@nestjs/testing'
import type { Repository } from 'typeorm'
import { Test } from '@nestjs/testing'
import { getRepositoryToken } from '@nestjs/typeorm'
import { In } from 'typeorm'
import { SoundDisplayName } from './sound-display-name.entity'
import { SoundDisplayNameService } from './sound-display-name.service'

describe('soundDisplayNameService', () => {
  let service: SoundDisplayNameService
  let repo: jest.Mocked<Pick<Repository<SoundDisplayName>, 'findOne' | 'find' | 'delete' | 'upsert'>>

  beforeEach(async () => {
    const mockFindOne = jest.fn()
    const mockFind = jest.fn()
    const mockDelete = jest.fn().mockResolvedValue({ affected: 1 })
    const mockUpsert = jest.fn().mockResolvedValue(undefined)

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SoundDisplayNameService,
        {
          provide: getRepositoryToken(SoundDisplayName),
          useValue: {
            findOne: mockFindOne,
            find: mockFind,
            delete: mockDelete,
            upsert: mockUpsert,
          },
        },
      ],
    }).compile()

    service = module.get<SoundDisplayNameService>(SoundDisplayNameService)
    repo = module.get(getRepositoryToken(SoundDisplayName))
  })

  it('getDisplayName returns null when no row', async () => {
    (repo.findOne as jest.Mock).mockResolvedValue(null)
    const result = await service.getDisplayName('music', 's1')
    expect(result).toBeNull()
    expect(repo.findOne).toHaveBeenCalledWith({
      where: { category: 'music', soundId: 's1' },
    })
  })

  it('getDisplayName returns displayName when row exists', async () => {
    (repo.findOne as jest.Mock).mockResolvedValue({
      category: 'music',
      soundId: 's1',
      displayName: 'My Track',
    })
    const result = await service.getDisplayName('music', 's1')
    expect(result).toBe('My Track')
  })

  it('setDisplayName with empty string deletes row', async () => {
    await service.setDisplayName('music', 's1', '   ')
    expect(repo.delete).toHaveBeenCalledWith({ category: 'music', soundId: 's1' })
    expect(repo.upsert).not.toHaveBeenCalled()
  })

  it('setDisplayName with non-empty string upserts', async () => {
    await service.setDisplayName('music', 's1', '  Custom Name  ')
    expect(repo.upsert).toHaveBeenCalledWith(
      { category: 'music', soundId: 's1', displayName: 'Custom Name' },
      { conflictPaths: ['category', 'soundId'] },
    )
  })

  it('getDisplayNamesBySoundIds returns empty map for empty array', async () => {
    const map = await service.getDisplayNamesBySoundIds('music', [])
    expect(map.size).toBe(0)
    expect(repo.find).not.toHaveBeenCalled()
  })

  it('getDisplayNamesBySoundIds returns map of soundId to displayName', async () => {
    (repo.find as jest.Mock).mockResolvedValue([
      { soundId: 's1', displayName: 'Track A' },
      { soundId: 's2', displayName: 'Track B' },
    ])
    const map = await service.getDisplayNamesBySoundIds('music', ['s1', 's2'])
    expect(map.get('s1')).toBe('Track A')
    expect(map.get('s2')).toBe('Track B')
    expect(repo.find).toHaveBeenCalledWith({
      where: { category: 'music', soundId: In(['s1', 's2']) },
    })
  })

  it('deleteDisplayName calls delete', async () => {
    await service.deleteDisplayName('effects', 'e1')
    expect(repo.delete).toHaveBeenCalledWith({ category: 'effects', soundId: 'e1' })
  })
})
