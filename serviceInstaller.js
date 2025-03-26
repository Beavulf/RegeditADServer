var Service = require('node-windows').Service;

// Создаем новый объект сервиса
var svc = new Service({
  name: 'RegeditADService',
  description: 'Сервис сервера Node.js приложения RegeditAD.',
  script: 'C:\\Orojects\\server.js' // укажите полный путь к вашему файлу app.js
});

// Событие "install" - сервис успешно установлен
svc.on('install', function() {
  svc.start();
  console.log('Сервис установлен и запущен.');
});

svc.install();
