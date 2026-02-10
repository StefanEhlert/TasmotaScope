import express from 'express'
import cors from 'cors'
import { backupRouter } from './backup.js'

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json({ limit: '1mb' }))
app.use('/api', backupRouter)

app.listen(PORT, () => {
  console.log(`TasmotaScope Backend listening on port ${PORT}`)
})
