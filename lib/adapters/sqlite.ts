import type BetterSqlite3 from 'better-sqlite3'
import { DateTime, Duration } from 'luxon'
import type { TableWithColumns } from 'sql-ts'
import type { IValueTable } from '../builder/sql'
import { SQLBuilder } from '../builder/sql'
import type { GetOptions, MapperOptions } from '../types/generics.t'
import type { SQLite3Options } from '../types/sqlite.t'
import { GenericAdapter } from './generic'

export class SQLiteAdapter extends GenericAdapter {
  // Builders
  /** SQLBuilder Instance */
  private readonly _sqlBuilder = new SQLBuilder('sqlite')
  /** SQLBuilder IValueTable Instantiated Instance */
  private table: TableWithColumns<IValueTable>

  // Instancing
  /** SQLite3Options Instance */
  private readonly options: SQLite3Options
  /** SQL Engine */
  private readonly _sqlEngine: typeof BetterSqlite3
  /** SQL Engine Instance */
  private database: BetterSqlite3.Database

  /**
   * Initialize the SQLite3 Adapter
   *
   * @remarks
   *
   * Make sure to call SQLiteAdapter#configure() before attempting to use the database.
   *
   * This will asynchronously configure the database and tables before usage.
   *
   * @param options - The SQLite3Options used to configure the state of the database.
   */
  public constructor (options: SQLite3Options) {
    super()
    this.options = options

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
      this._sqlEngine = require('better-sqlite3')
    } catch (err: unknown) {
      const error = err as Error
      throw new Error(`[init] NAMESPACE(${this.options.table ?? 'NULL_VAL_PROVIDED_TABLE_NAME'}): Failed to detect installation of SQLite3. Please install 'better-sqlite3' with your preferred package manager to enable this adapter.\n${(error.stack !== undefined ? error.stack : error.message)}`)
    }

    if (options.file === undefined || options.table === undefined) {
      throw new Error(`[init] NAMESPACE(${this.options.table ?? 'NULL_VAL_PROVIDED_TABLE_NAME'}): Failed to detect SQlite3Options. Please specify both the 'file' and the 'table' you wish to use.`)
    }
  }

  /**
   * Asynchronously configure the SQLite3Adapter to enable usage.
   */
  public async configure (): Promise<void> {
    // Initialize Keys and Storage
    this.table = this._sqlBuilder.getVTable(this.options.table)

    // Lock Database Connection
    await this.lockDB()

    // Create Storage Table
    try {
      await this.run(this.table.create().ifNotExists().toString())
    } catch (err: unknown) {
      const error = err as Error
      throw new Error(`[runtime:configure NAMESPACE(${this.options.table!}): Failed to configure value-storage table.\n${(error.stack !== undefined ? error.stack : error.message)}`)
    }
  }

  /**
   * Terminate the SQLite Database Connection and end active service.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  public async close (): Promise<void> {
    this.database.close()
  }

  /**
   * Permanently removes all entries from the referenced storage driver.
   */
  public async clear (): Promise<void> {
    await this.run(this.table.delete().from().toString())
  }

  /**
   * Permanently removes the value assigned to the supplied key from the referenced storage driver.
   *
   * @param key - The referenced key to remove from the storage adapter.
   *
   * @returns - If the value assigned to the key was deleted.
   */
  public async delete (key: string): Promise<boolean> {
    super._isKeyAcceptable(key)

    await this.run(this.table.delete().where({ key }).toString())

    return true
  }

  /**
   * Retrieves the value assigned to the supplied key from the referenced storage driver.
   *
   * @param key - The referenced key to obtain from the storage driver.
   * @param options - [optional] Specify the default value for the response, at this time.
   *
   * @returns - The value assigned to the key.
   */
  public async get (key: string, options?: GetOptions): Promise<unknown | unknown[]> {
    super._isKeyAcceptable(key)

    if (!Array.isArray(key)) {
      const state = await this.getOne(this.table.select().where({ key }).toString())
      const deserialized = super._deserialize(state)
      if (deserialized === undefined) return options?.default

      if (super._isMapperExpired(deserialized)) {
        await this.delete(key)
        return options?.default
      }

      return deserialized.ctx
    } else {
      const response = []

      for (const k of key as string[]) {
        const state = await this.getOne(this.table.select().where({ key: k }).toString())
        const deserialized = super._deserialize(state)
        if (deserialized === undefined) {
          response.push({
            key: k,
            value: options?.default
          })
          continue
        }
        if (super._isMapperExpired(deserialized)) {
          await this.delete(k)
          response.push({
            key: k,
            value: options?.default
          })
          continue
        }

        response.push({
          key: k,
          value: deserialized.ctx
        })
      }

      return response
    }
  }

  /**
   * Assert if the referenced storage driver contains the supplied key.
   *
   * @param key - The referenced key to check existence in the storage driver.
   *
   * @returns - If the key exists.
   */
  public async has (key: string): Promise<boolean> {
    super._isKeyAcceptable(key)
    if (await this.get(key) === undefined) return false
    return true
  }

  /**
   * Retrieves all known keys from the storage driver.
   *
   * @returns - An array of all known keys in no particular order.
   */
  public async keys (): Promise<string[]> {
    const keys = await this.getAll(this.table.select(this.table.key).toString())

    const result: string[] = []
    keys.map((k) => result.push(k.key))

    return result
  }

  /**
   * Insert the provided value at the referenced key.
   *
   * @param key - The referenced key to insert the value in the storage driver.
   * @param value - The provided value to insert at the referenced key.
   * @param options - The MapperOptions to control the aspects of the stored key.
   */
  public async set (key: string, value: unknown, options?: MapperOptions): Promise<void> {
    super._isKeyAcceptable(key)

    await this.run(this.table.replace({
      key,
      value: super._serialize({
        key,
        ctx: value,
        lifetime: (options?.lifetime !== undefined ? DateTime.local().toUTC().plus(Duration.fromObject({ milliseconds: options.lifetime })).toUTC().toISO() : null),
        createdAt: DateTime.local().toUTC().toISO(),
        encoder: {
          use: (this.options.encoder?.use === undefined ? false : this.options.encoder.use),
          store: this.options.encoder?.store === undefined ? 'base64' : this.options.encoder.store,
          parse: this.options.encoder?.parse === undefined ? 'utf-8' : this.options.encoder.parse
        }
      })
    }).toString())
  }

  /** Lock Database Service */
  // eslint-disable-next-line @typescript-eslint/require-await
  private async lockDB (): Promise<void> {
    try {
      this.database = new this._sqlEngine(this.options.file!.toString())
    } catch (err: unknown) {
      const error = err as Error
      throw new Error(`[runtime:lock NAMESPACE(${this.options.table!}): Failed to initialize SQLite3 adapter due to an unexpected error.\n${(error.stack !== undefined ? error.stack : error.message)}`)
    }
  }

  /** No-Result Query */
  private async run (sql: string): Promise<void> {
    await new Promise((resolve, reject) => {
      try {
        this.database.prepare(sql).run()
        resolve({})
        return
      } catch (err: unknown) {
        reject(err)
      }
    })
  }

  /** Single-Result Query */
  private async getOne (sql: string): Promise<IValueTable> {
    return await new Promise((resolve, reject) => {
      try {
        resolve(this.database.prepare(sql).get()); return
      } catch (err: unknown) {
        reject(err)
      }
    })
  }

  /** All-Result Query */
  private async getAll (sql: string): Promise<IValueTable[]> {
    return await new Promise((resolve, reject) => {
      try {
        resolve(this.database.prepare(sql).all()); return
      } catch (err: unknown) {
        reject(err)
      }
    })
  }
}
