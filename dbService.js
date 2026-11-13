//МЕТОДЫ ДЛЯ ОБРАЩЕНИЯ К БД
const { ObjectId } = require('mongodb');
const schemas = require('./mongoose.js');
const {logger} = require('./helper/Logger.js');

// ошибка, сообщение которой можно безопасно показать клиенту
class ValidationError extends Error {
    constructor(message) {
        super(message);
        this.userMessage = message;
    }
}

// получение модели коллекции с проверкой (Mongoose — служебный экспорт, не модель)
function getModel(collection) {
    if (!collection || typeof collection !== 'string') return null;
    if (collection === 'Mongoose') return null;
    return schemas[collection] || null;
}

// безопасное создание ObjectId с понятной ошибкой вместо CastError
function toObjectId(id, fieldName = 'ID') {
    try {
        return new ObjectId(id);
    } catch {
        throw new ValidationError(`Некорректный формат ${fieldName}: "${id}"`);
    }
}

// кеширование опций populate на схеме (выполняется один раз для каждой модели)
function getPopulateOptions(schema) {
    if (!schema._populateOptions) {
        schema._populateOptions = Object.entries(schema.paths)
            .filter(([_, path]) => path.options && path.options.ref)
            .map(([key, path]) => ({
                path: key,
                select: key === '_sotr' ? 'fio' : 'name',
            }));
    }
    return schema._populateOptions;
}

// единый формат сообщения об ошибке для клиента (детали — только в лог)
function toClientError(err) {
    return err.userMessage || err.codeName || err.message || String(err);
}

//получения списка из коллекций
async function getCollectionMongoose(data) {
    try {
        const Model = getModel(data?.collection);
        if (!Model) {
            if (data?.collection === 'Clients') {return {message:'Клиенты получены'}}
            logger.warn(`Модель для коллекции ${data?.collection} не найдена.`);
            return {error:`Коллекция не найдена ${data?.collection}`};
        }
        const collData = await Model.find(data.filter || {})
            .populate(getPopulateOptions(Model.schema))
            .lean()
            .exec();
        return collData;
    } catch (err) {
        logger.error(`Ошибка при получении коллекции БД: \n ${err}`);
        return {error:`Ошибка при получении коллекции: ${toClientError(err)}`, logErr:err};
    }
}

// получение одного документа по id (используется change stream в server.js)
async function getDocumentById(collection, id) {
    try {
        const Model = getModel(collection);
        if (!Model || !id) return null;
        return await Model.findById(toObjectId(id))
            .populate(getPopulateOptions(Model.schema))
            .lean()
            .exec();
    } catch (err) {
        if (!(err instanceof ValidationError)) {
            logger.error(`Ошибка при получении документа ${collection} по id ${id}: ${err}`);
        }
        return null;
    }
}

// добавление записи в коллекцию
async function insertInToCollection(data) {
    try {
        const Model = getModel(data?.collection);
        if (!Model) {
            logger.warn(`Модель для коллекции ${data?.collection} не найдена.`);
            return {error:`Модель для коллекции ${data?.collection} не найдена.`};
        }
        if (!data.body || (typeof data.body !== 'object')) {
            return {error:'Не переданы данные для добавления (body).'};
        }
        const body = Array.isArray(data.body) ? data.body : [data.body];
        const hasEmpty = body.some((item) => !item || typeof item !== 'object' || Array.isArray(item));
        if (hasEmpty) {
            return {error:'Переданы некорректные данные для добавления (body).'};
        }

        const result = await Model.insertMany(body);
        logger.info(`Успешное добавление записи в коллекцию ${data.collection} (${result.length} шт.).`);
        return {ok:true, inserted:result.length};
    } catch (err) {
        logger.error(`Ошибка при добавлении записей в БД: \n ${err}`);
        // дубликат уникального индекса — частый понятный случай
        if (err.code === 11000) {
            return {error:'Запись с таким уникальным значением уже существует.', logErr:err};
        }
        if (err.name === 'ValidationError') {
            return {error:`Проверка данных не пройдена: ${err.message}`, logErr:err};
        }
        return {error:`Ошибка при добавлении: ${toClientError(err)}`, logErr:err};
    }
}

// Обновление строки в коллекции с возвратом расширенных данных
async function updateInCollection(data) {
    try {
        const Model = getModel(data?.collection);
        if (!Model) {
            logger.warn(`Модель для коллекции ${data?.collection} не найдена.`);
            return {error:`Модель для коллекции ${data?.collection} не найдена.`};
        }
        const populateOptions = getPopulateOptions(Model.schema);

        //для обновления прав доки и настд (передается массив)
        if (Array.isArray(data.value)) {
            if (data.value.length === 0) {
                return {error:'Передан пустой массив для обновления.'};
            }
            const invalid = data.value.find((item) => !item?._pdoka);
            if (invalid) {
                return {error:'В элементе обновления отсутствует _pdoka.'};
            }

            const bulkOperations = data.value.map((item) => ({
                updateOne: {
                    filter: { _id: toObjectId(item._pdoka, '_pdoka') },
                    update: { $set: { ...item, is_locked: false } },
                },
            }));

            const result = await Model.bulkWrite(bulkOperations);
            logger.info(`bulkWrite в коллекции ${data.collection}: изменено ${result.modifiedCount ?? result.nModified} из ${bulkOperations.length}.`);

            // Оптимизация: получение только _id обновленных документов
            const updatedIds = data.value.map((item) => toObjectId(item._pdoka, '_pdoka'));
            const updatedDocuments = await Model.find({ _id: { $in: updatedIds } })
                .populate(populateOptions)
                .lean()
                .exec();
            return updatedDocuments;
        }

        if (!data.value || typeof data.value !== 'object' || Array.isArray(data.value)) {
            return {error:'Не переданы данные для обновления (value).'};
        }
        if (!data.filter?._id) {
            return {error:'Не указан ID документа для обновления (filter._id).'};
        }

        const result = await Model.findOneAndUpdate(
            { _id: toObjectId(data.filter._id) },
            { $set: data.value },
            { new: true, runValidators: false } // Важно для получения обновленного документа
        )
        .populate(populateOptions)
        .lean()
        .exec();

        if (!result) {
            logger.warn(`Документ для обновления не найден: ${data.collection} / ${data.filter._id}`);
            return {error:'Документ для обновления не найден.'};
        }
        return result; //возвращаем результат
    } catch (err) {
        logger.error(`Ошибка при изменении записи в БД: \n ${err}`);
        if (err.code === 11000) {
            return {error:'Запись с таким уникальным значением уже существует.', logErr:err};
        }
        return {error:toClientError(err), logErr:err};
    }
}

//удаление строки из коллекции
async function deleteFromCollection (data) {
    try {
        if (!data?.filter?._id) {
            logger.warn('ID документа не указан');
            return {error:'ID документа не указан'};
        }

        const Model = getModel(data.collection);
        if (!Model) {
            logger.warn(`Модель для коллекции ${data.collection} не найдена.`);
            return {error:'Коллекция не найдена'};
        }

        // защита дефолтных значений для отдела и должности
        if ([`Otdel`, `Doljnost`].includes(data.collection)) {
            const defaultName = data.collection === 'Otdel' ? 'Удаленный отдел' : 'Удаленная должность';
            const defaultDoc = await Model.findOne({ name: defaultName });
            if (!defaultDoc) {
                logger.error(`Дефолтная запись "${defaultName}" не найдена в коллекции ${data.collection}.`);
                return {error:`Дефолтная запись "${defaultName}" не найдена. Сначала создайте её.`};
            }
            if (toObjectId(data.filter._id).equals(defaultDoc._id)) {
                logger.warn('Попытка удаления дефолтных значений.');
                return {error:'Попытка удаления дефолтных значений невозможна.'};
            }
        }

        const docId = toObjectId(data.filter._id);
        const deletedDocument = await Model.findById(docId);

        if (!deletedDocument) {
            logger.warn('Документ не найден для удаления');
            return {error:'Документ не найден'};
        }
        await deletedDocument.deleteOne()

        // ссылки на удалённый отдел/должность заменяем на дефолтные
        if ([`Otdel`, `Doljnost`].includes(data.collection)) {
            const defaultName = data.collection === 'Otdel' ? 'Удаленный отдел' : 'Удаленная должность';
            const defaultDoc = await Model.findOne({ name: defaultName });
            if (defaultDoc) {
                await updateReferencesAfterDelete(deletedDocument._id, data.collection, defaultDoc._id);
            } else {
                logger.error(`Дефолтная запись "${defaultName}" не найдена — ссылки на удалённую запись не заменены.`);
            }
        }

        return 'Удаление и обновление завершены';
    } catch (err) {
        logger.error(`Ошибка при удалении записи из БД: \n ${err}`);
        return {error:`Ошибка при удалении: ${toClientError(err)}`,logErr:err};
    }
}

// замена ссылок на удалённую запись (targetCollection) на дефолтную во всех коллекциях
async function updateReferencesAfterDelete(deletedId, targetCollection, defaultId) {
    try {
        // Перебор всех моделей, зарегистрированных в `schemas`
        for (const [modelName, model] of Object.entries(schemas)) {
            if (modelName === 'Mongoose' || !model?.schema) continue;
            const schema = model.schema;

            // Поиск полей, которые ссылаются на указанную коллекцию
            const foreignKeyFields = Object.entries(schema.paths)
                .filter(([fieldName, field]) => field.options && field.options.ref === targetCollection)
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
                    `Обновлено документов в коллекции "${modelName}" для поля "${targetCollection}": ${
                        result.modifiedCount ?? result.nModified
                    }`
                );
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
    getCollectionMongoose,
    getDocumentById
}
