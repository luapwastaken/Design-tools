@echo off
cd /d "%~dp0"
start /min "Design Tools" cmd /k "npm run dev"
