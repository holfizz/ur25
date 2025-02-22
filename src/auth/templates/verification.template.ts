export const VerificationTemplate = () => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.6;
      margin: 0;
      padding: 0;
      background-color: #f5f5f5;
    }
    .container {
      max-width: 600px;
      margin: 40px auto;
      background: white;
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.05);
      overflow: hidden;
    }
    .header {
      background: #6B5ECD;
      padding: 30px;
      text-align: center;
    }
    .header img {
      width: 120px;
      margin-bottom: 20px;
    }
    .content {
      padding: 40px 30px;
      color: #333;
    }
    .button {
      display: inline-block;
      background: #6B5ECD;
      color: white;
      text-decoration: none;
      padding: 12px 30px;
      border-radius: 6px;
      margin: 20px 0;
      font-weight: 500;
    }
    .footer {
      background: #f8f9fa;
      padding: 20px;
      text-align: center;
      color: #6c757d;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="https://ur25.ru/logo.svg" alt="UR25 Logo">
      <h1 style="color: white; margin: 0;">Аккаунт верифицирован</h1>
    </div>
    <div class="content">
      <h2>Поздравляем! 🎉</h2>
      <p>Ваш аккаунт успешно прошел верификацию администратором.</p>
      <p>Теперь вы можете войти в систему и получить доступ ко всем функциям платформы.</p>
      <div style="text-align: center;">
        <a href="https://t.me/ur25_bot" class="button">Открыть бота</a>
      </div>
      <p style="margin-top: 30px;">
        С уважением,<br>
        Команда UR25
      </p>
    </div>
    <div class="footer">
      © 2024 UR25. Все права защищены.
    </div>
  </div>
</body>
</html>
`
