#!/usr/bin/env bun
import { runApp } from "../src/renderer/app.js"

runApp().catch((err) => {
  console.error(err)
  process.exit(1)
})
