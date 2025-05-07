//МЕТОДЫ ДЛЯ ОБРАЩЕНИЯ К БД
const { ObjectId } = require('mongodb');
const schemas = require('./mongoose.js');
const {logger} = require('./helper/Logger.js');

//получения списка ис коллекций
async function getCollectionMongoose(data) {
    try {
        const Model = schemas[data.collection]; // Получаем модель один раз
        if (!Model) { // Проверка на существование модели
            logger.warn(`Модель для коллекции ${data.collection} не найдена.`);
            return {error:'Коллекция не найдена'}; // Возвращаем пустой массив, чтобы избежать ошибок
        }
        const schema = Model.schema;

        // Оптимизация: кеширование опций populate
        if (!schema._populateOptions) {
            schema._populateOptions = Object.entries(schema.paths)
                .filter(([_, path]) => path.options && path.options.ref)
                .map(([key, path]) => ({
                    path: key,
                    select: key === '_sotr' ? 'fio' : 'name',
                }));
        }

        const filter = data.filter || {};
        const collData = await Model.find(filter)
            .populate(schema._populateOptions)
            .lean()
            .exec();
        return collData;
    } catch (err) {
        logger.error(`Ошибка при получении коллекции БД: \n ${err}`);
        return {error:`Ошибка при получении коллекции: ${err.codeName}`, logErr:err};
    }
}

// добавление записи в коллекцию
async function insertInToCollection(data) {
    try {
        const Model = schemas[data.collection];
        if (!Model) {
            logger.warn(`Модель для коллекции ${data.collection} не найдена.`);
            return {error:`Модель для коллекции ${data.collection} не найдена.`};
        }
        const body = Array.isArray(data.body) ? data.body : [data.body];
        const result = await Model.insertMany(body);
        logger.info(`Успешное добавление записи в коллекцию ${data.collection}.`);
        return `Insert complete`;
    } catch (err) {
        logger.error(`Ошибка при добавлении записей в БД: \n ${err}`);
        return {error:`: \n ${err}`, logErr:err};
    }
}

// Обновление строки в коллекции с возвратом расширенных данных
async function updateInCollection(data) {
    try {
        const Model = schemas[data.collection];
        if (!Model) {
            logger.warn(`Модель для коллекции ${data.collection} не найдена.`);
            return null;
        }
        const schema = Model.schema;

        if (!schema._populateOptions) {
            schema._populateOptions = Object.entries(schema.paths)
                .filter(([_, path]) => path.options && path.options.ref)
                .map(([key, path]) => ({
                    path: key,
                    select: key === '_sotr' ? 'fio' : 'name',
                }));
        }

        //для обновление прав доки и настд (передается массив)
        if (Array.isArray(data.value)) {
            const bulkOperations = data.value.map((item) => ({
                updateOne: {
                    filter: { _id: new ObjectId(item._pdoka) },
                    update: { $set: { ...item, is_locked: false } },
                },
            }));

            const result = await Model.bulkWrite(bulkOperations).catch(err => {
                logger.error(`Ошибка при выполнении bulkWrite: ${err}`);
                throw err;
            });;
            // Оптимизация: получение только _id обновленных документов
            const updatedIds = data.value.map((item) => new ObjectId(item._pdoka));
            const updatedDocuments = await Model.find({ _id: { $in: updatedIds } })
                .populate(schema._populateOptions)
                .lean()
                .exec();
            return updatedDocuments;
        } else {
            const result = await Model.findOneAndUpdate(
                { _id: new ObjectId(data.filter._id) },
                { $set: data.value },
                { new: true } // Важно для получения обновленного документа
            )
            .populate(schema._populateOptions)
            .lean()
            .exec();

            return result; //возвращаем результат
        }
    } catch (err) {
        logger.error(`Ошибка при изменении записи в БД: \n ${err}`);
        return {error:err.codeName, logErr:err};
    }
}

//удаление строки из коллекции
async function deleteFromCollection (data) {
    try {
        if (!data.filter?._id) {
            logger.warn('ID документа не указан');
            return {error:'ID документа не указан'};
          }
          
        const Model = schemas[data.collection];
        if (!Model) {
            logger.warn(`Модель для коллекции ${data.collection} не найдена.`);
            return {error:'Коллекция не найдена'}; // Возвращаем сообщение об ошибке
        }

        if ([`Otdel`, `Doljnost`].includes(data.collection)) {
            const [fiendOtdelID, fiendDoljnostID] = await Promise.all([
                schemas['Otdel'].findOne({ name: 'Удаленный отдел' }),
                schemas['Doljnost'].findOne({ name: 'Удаленная должность' })
              ]);

            if (new ObjectId(data.filter._id).equals(fiendOtdelID._id) || new ObjectId(data.filter._id).equals(fiendDoljnostID._id)) {
                logger.warn('Попытка удаления дефолтных значений.');
                return {error:'Попытка удаления дефолтных значений невозможна.'};
            }
        }
        const deletedDocument = await Model.findById(new ObjectId(data.filter._id));

        if (!deletedDocument) {
            logger.warn('Документ не найден для удаления');
            return {error:'Документ не найден'};
        }
        await deletedDocument.deleteOne()
        if ([`Otdel`, `Doljnost`].includes(data.collection)) {
            const fiendOtdelID = await schemas[`Otdel`].findOne({ name: 'Удаленный отдел' });
            const fiendDoljnostID = await schemas[`Doljnost`].findOne({ name: `Удаленная должность` });
            const deletedIds = [
                { deletedId: deletedDocument._id, defaultId: fiendOtdelID._id, targetRef: 'Otdel' },
                { deletedId: deletedDocument._id, defaultId: fiendDoljnostID._id, targetRef: 'Doljnost' },
            ];
            await updateReferencesAfterDelete(deletedIds);
        }

        return 'Удаление и обновление завершены';
    } catch (err) {
        logger.error(`Ошибка при удалении записи из БД: \n ${err}`);
        return {error:`Ошибка при удалении: ${err.codeName}`,logErr:err};
    }
}
// Функция для обновления сотрудников, назначая новый отдел
async function updateReferencesAfterDelete(deletedIds, targetRefs) {
    try {
        // Перебор всех моделей, зарегистрированных в `schemas`
        for (const [modelName, model] of Object.entries(schemas)) {
            const schema = model.schema;

            // Обработка каждой пары: { удалённый ID, коллекция-цель }
            for (const { deletedId, defaultId, targetRef } of deletedIds) {
                // Поиск полей, которые ссылаются на указанную коллекцию
                const foreignKeyFields = Object.entries(schema.paths)
                    .filter(([fieldName, field]) => field.options && field.options.ref === targetRef)
                    .map(([fieldName]) => fieldName);

                // Если есть такие поля, обновить документы
                if (foreignKeyFields.length > 0) {
                    const updateQuery = foreignKeyFields.reduce((query, field) => {
                        query[field] = deletedId; // Поля с удалённым ID
                        return query;
                    }, {});

                    const updateSet = foreignKeyFields.reduce((set, field) => {
                        set[field] = defaultId; // Замена на дефолтный ID
                        return set;
                    }, {});

                    const result = await model.updateMany(updateQuery, { $set: updateSet });

                    logger.info(
                        `Обновлено документов в коллекции "${modelName}" для поля "${targetRef}": ${
                            result.nModified || result.modifiedCount
                        }`
                    );
                }
            }
        }
    } catch (err) {
        logger.error(`Ошибка при обновлении ссылок: ${err}`);
    }
}

module.exports = {
    insertInToCollection,
    updateInCollection,
    deleteFromCollection,
    getCollectionMongoose
}