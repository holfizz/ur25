export const ActualityCheckTemplate = (data: {
	title: string
	quantity: number
	price: number
}) => `
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
    .offer-details {
      background: #f8f9fa;
      padding: 20px;
      border-radius: 8px;
      margin: 20px 0;
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
      <h1 style="color: white; margin: 0;">Проверка актуальности</h1>
    </div>
    <div class="content">
      <h2>Здравствуйте! 👋</h2>
      <p>Прошло 10 дней с момента последней проверки вашего объявления. Пожалуйста, подтвердите его актуальность:</p>
      <div class="offer-details">
        <h3 style="margin-top: 0;">${data.title}</h3>
        <p>Количество: ${data.quantity} голов</p>
        <p>Цена: ${data.price} ₽/гол</p>
      </div>
      <div style="text-align: center;">
        <a href="https://t.me/ur25_bot" class="button">Проверить в Telegram</a>
      </div>
      <p style="margin-top: 30px;">
        Для подтверждения актуальности или приостановки объявления, пожалуйста, перейдите в Telegram-бот.
      </p>
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
