const mongoose = require('mongoose');
require('dotenv').config()
mongoose.pluralize(null)
mongoose.connect(process.env.MONGO_DB_CONNECTION_URL);
const {Schema, model} = mongoose

////////////////////////////////////////////////////
const usersSchema = new Schema({
    name: {
        type: String,
        required: true,
        unique: true,
    },
    role: {
        type: String,
        required: true,
    },
    address: { type: String, required: true, unique: true, },
    is_locked: Boolean,
})
const users = model('Users', usersSchema);
////////////////////////////////////////////////////

////////////////////////////////////////////////////
const otdelSchema = new Schema({
    name: {
        type: String,
        required: true,
        unique: true,
    },
    descrip: String,
    is_locked: Boolean,
})

const otdel = model('Otdel', otdelSchema);
///////////////////////////////////////////////////

////////////////////////////////////////////////////
const doljnostSchema = new Schema({
    name: {
        type: String,
        required: true,
        unique: true,
    },
    descrip: String,
    is_locked: Boolean,
})
const doljnost = model('Doljnost', doljnostSchema);
///////////////////////////////////////////////////

////////////////////////////////////////////////////
const sotrudnikSchema = new Schema({
    fio: { type: String, required: true },
    _doljnost: { type: Schema.Types.ObjectId, ref: `Doljnost`, required: true},
    _otdel: { type: Schema.Types.ObjectId, ref: `Otdel`,required: true},
    phone: { type: String },
    lnp: {type: Number},
    login: { type: String, required: true, unique: true},
    descrip: String,
    is_locked: Boolean,
})

// Добавляем функци перед удалением сотрудника если использовалась команда deleteOne
sotrudnikSchema.pre('deleteOne', { document: true, query: false }, async function() {
    await deleteRelatedDocuments(this._id);
});

// Добавляем функци перед удалением сотрудника если использовалась команда findOneAndDelete
sotrudnikSchema.pre('findOneAndDelete', async function() {
    const doc = await this.model.findOne(this.getFilter());
    if (doc) {
        await deleteRelatedDocuments(doc._id);
    }
});

// Удаление связанных таблиц с сотрудником
async function deleteRelatedDocuments(sotrudnikId) {
    await Promise.all([
        pdoka.deleteMany({ _sotr: sotrudnikId }),
        priem.deleteMany({ _sotr: sotrudnikId }),
        sbrosad.deleteMany({ _sotr: sotrudnikId }),
        naznachenie.deleteMany({ _sotr: sotrudnikId }),
        perevod.deleteMany({ _sotr: sotrudnikId }),
        vperevod.deleteMany({ _sotr: sotrudnikId }),
        familia.deleteMany({ _sotr: sotrudnikId }),
        uvolnenie.deleteMany({ _sotr: sotrudnikId }),
        zapros.deleteMany({ _sotr: sotrudnikId }),
        svodka.deleteMany({ _sotr: sotrudnikId }),
        revizor.deleteMany({ _sotr: sotrudnikId }),
        chdti.deleteMany({ _sotr: sotrudnikId }),
        aipsin.deleteMany({ _sotr: sotrudnikId }),
        stajirovka.deleteMany({ _sotr: sotrudnikId })
    ]);
}

const sotrudnik = model('Sotrudnik', sotrudnikSchema);
///////////////////////////////////////////////////

////////////////////////////////////////////////////
const pdokaSchema = new Schema({
    _pto: { type: Schema.Types.ObjectId, ref: `Otdel`,required: true },
    _sotr: { type: Schema.Types.ObjectId, ref: `Sotrudnik`, required: true},
    type: {type: String, required: true},
    lnp: {type: Number, required: true},
    obosnovanie: {type: String, required: true},
    data_prikaza: {type: Date, required: true},
    data_dob: {type: Date, required: true},
    _who: {type: Schema.Types.ObjectId, ref: `Users`, required: true},
    _who_do: {type: Schema.Types.ObjectId, ref: `Users`, required: true},
    descrip: {type: String},
    is_locked: Boolean,
})

 const pdoka = model('Pdoka', pdokaSchema);
///////////////////////////////////////////////////

////////////////////////////////////////////////////
const priemSchema = new Schema({
    _sotr: { type: Schema.Types.ObjectId, ref: `Sotrudnik`, required: true},
    prikaz: {type: String, required: true},
    data_priema: {type: Date, required: true},
    data_prikaza: {type: Date, required: true},
    data_dob: {type: Date, required: true},
    _who: {type: Schema.Types.ObjectId, ref: `Users`, required: true},
    descrip: {type: String},
    is_locked: Boolean,
})
 const priem = model('Priem', priemSchema);
///////////////////////////////////////////////////

////////////////////////////////////////////////////
const sbrosadSchema = new Schema({
    _otdel: { type: Schema.Types.ObjectId, ref: `Otdel`,required: true },
    _sotr: { type: Schema.Types.ObjectId, ref: `Sotrudnik`, required: true},
    action: {type: String, required: true},
    data: {type: Date, required: true},
    _who_do: {type: Schema.Types.ObjectId, ref: `Users`, required: true},
    data_dob: {type: Date, required: true},
    _who: {type: Schema.Types.ObjectId, ref: `Users`, required: true},
    descrip: {type: String},
    is_locked: Boolean,
})
 const sbrosad = model('SbrosAD', sbrosadSchema);
///////////////////////////////////////////////////

////////////////////////////////////////////////////
const subjectSchema = new Schema({
    name: {type: String, required: true},
    data_dob: {type: Date, required: true},
    _who: {type: Schema.Types.ObjectId, ref: `Users`, required: true},
    descrip: {type: String},
    is_locked: Boolean,
})

// перед удалением
subjectSchema.pre('deleteOne', { document: true, query: false }, async function() {
    await deleteRelatedSubjectDocuments(this._id);
});

// перед удалением
subjectSchema.pre('findOneAndDelete', async function() {
    const doc = await this.model.findOne(this.getFilter());
    if (doc) {
        await deleteRelatedSubjectDocuments(doc._id);
    }
});

async function deleteRelatedSubjectDocuments(subjectId) {
    await Promise.all([
        contract.deleteMany({ _subj: subjectId }),
        prodlenie.deleteMany({ _contr: { $in: await contract.find({ _subj: subjectId }).distinct('_id') } })
    ]);
}
 const subject = model('Subject', subjectSchema);
///////////////////////////////////////////////////

////////////////////////////////////////////////////
const companySchema = new Schema({
    name: {type: String, required: true},
    unp: {type: Number, unique: true},
    data_dob: {type: Date, required: true},
    _who: {type: Schema.Types.ObjectId, ref: `Users`, required: true},
    descrip: {type: String},
    is_locked: Boolean,
})

async function handleDeletedCompanyDocuments(companyId) {
    const deletedCompany = await company.findOne({ name: "Удаленная компания" });
    
    if (!deletedCompany) {
        throw new Error("Не найдена компания 'Удаленная компания'");
    }

    // Обновляем все контракты, связанные с удаляемой компанией
    await contract.updateMany(
        { _com: companyId },
        { $set: { _com: deletedCompany._id } }
    );
}

// Добавляем пре-хуки для компании
companySchema.pre('deleteOne', { document: true, query: false }, async function() {
    await handleDeletedCompanyDocuments(this._id);
});

companySchema.pre('findOneAndDelete', async function() {
    const doc = await this.model.findOne(this.getFilter());
    if (doc) {
        await handleDeletedCompanyDocuments(doc._id);
    }
});

 const company = model('Company', companySchema);
///////////////////////////////////////////////////

////////////////////////////////////////////////////
const prodlenieSchema = new Schema({
    _contr: { type: Schema.Types.ObjectId, ref: `Contract`,required: true },
    ndata_dov: {type: Date},
    ndata_contr: {type: Date},
    prikaz: {type: String, required: true},
    data_prikaza: {type: Date, required: true},
    data_dob: {type: Date, required: true},
    _who: {type: Schema.Types.ObjectId, ref: `Users`, required: true},
    descrip: {type: String},
    is_locked: Boolean,
})
 const prodlenie = model('Prodlenie', prodlenieSchema);
///////////////////////////////////////////////////

////////////////////////////////////////////////////
const contractSchema = new Schema({
    _subj: { type: Schema.Types.ObjectId, ref: `Subject`,required: true },
    _com: { type: Schema.Types.ObjectId, ref: `Company`,required: true },
    data_cert: {type: Date, required: true},
    data_contr: {type: Date, required: true},
    data_dover: {type: Date, required: true},
    certif: {type: String, required: true},
    prikaz: {type: String, required: true},
    data_zakl: {type: Date, required: true},
    data_dob: {type: Date, required: true},
    time_edit: {type: Date, required: true},
    certif_edit: {type: Date},

    prikaz_anull: {type: String,},
    data_anull: {type: Date,},
    anull: Boolean,
    
    _who: {type: Schema.Types.ObjectId, ref: `Users`, required: true},
    descrip: {type: String},
    is_locked: Boolean,
})

// перед удалением
contractSchema.pre('deleteOne', { document: true, query: false }, async function() {
    await deleteRelatedContractDocuments(this._id);
});

// перед удалением
contractSchema.pre('findOneAndDelete', async function() {
    const doc = await this.model.findOne(this.getFilter());
    if (doc) {
        await deleteRelatedContractDocuments(doc._id);
    }
});

async function deleteRelatedContractDocuments(contractId) {
    await prodlenie.deleteMany({ _contr: contractId });
}

 const contract = model('Contract', contractSchema);
///////////////////////////////////////////////////

////////////////////////////////////////////////////
const accessSchema = new Schema({
    address: {type: String, required: true},
    login: {type: String, required: true},
    data_dob: {type: Date, required: true},
    is_locked: Boolean,
})
 const access = model('Access', accessSchema);
///////////////////////////////////////////////////

////////////////////////////////////////////////////
const feedbackSchema = new Schema({
    title: {type: String, required: true, trim:true},
    descrip: {type: String, default:''},
    image: {type: String, default:null},
    status: {type:String, default:'3,Отправлено'},
    data_dob: {type: Date, required: true},
    _who: {type: Schema.Types.ObjectId, ref: `Users`, required: true},
    is_locked: Boolean,
})
 const feedback = model('Feedback', feedbackSchema);
///////////////////////////////////////////////////

////////////////////////////////////////////////////
const naznachenieSchema = new Schema({
    _sotr: { type: Schema.Types.ObjectId, ref: `Sotrudnik`, required: true},
    prikaz: {type: String, required: true},
    data_prikaza: {type: Date, required: true},
    data_nazn: {type: Date, required: true},
    _pred_znach: { type: Schema.Types.ObjectId, ref: `Doljnost`},
    _new_znach: { type: Schema.Types.ObjectId, ref: `Doljnost`, required: true},
    data_dob: {type: Date, required: true},
    _who: {type: Schema.Types.ObjectId, ref: `Users`, required: true},
    descrip: {type: String},
    is_locked: Boolean,
})
 const naznachenie = model('Naznachenie', naznachenieSchema);
///////////////////////////////////////////////////

////////////////////////////////////////////////////
const perevodSchema = new Schema({
    _sotr: { type: Schema.Types.ObjectId, ref: `Sotrudnik`, required: true},
    prikaz: {type: String, required: true},
    data_prikaza: {type: Date, required: true},
    data_per: {type: Date, required: true},
    _otkyda: { type: Schema.Types.ObjectId, ref: `Otdel`},
    _kyda: { type: Schema.Types.ObjectId, ref: `Otdel`, required: true},
    data_dob: {type: Date, required: true},
    _who: {type: Schema.Types.ObjectId, ref: `Users`, required: true},
    descrip: {type: String},
    is_locked: Boolean,
})
 const perevod = model('Perevod', perevodSchema);
///////////////////////////////////////////////////

////////////////////////////////////////////////////
const vperevodSchema = new Schema({
    _sotr: { type: Schema.Types.ObjectId, ref: `Sotrudnik`, required: true},
    prikaz: {type: String, required: true},
    data_prikaza: {type: Date, required: true},
    data_n: {type: Date, required: true},
    data_k: {type: Date, required: true},
    _otkyda: { type: Schema.Types.ObjectId, ref: `Otdel`},
    _kyda: { type: Schema.Types.ObjectId, ref: `Otdel`, required: true},
    type: {type: String},
    data_dob: {type: Date, required: true},
    _who: {type: Schema.Types.ObjectId, ref: `Users`, required: true},
    descrip: {type: String},
    is_locked: Boolean,
})
 const vperevod = model('VPerevod', vperevodSchema);
///////////////////////////////////////////////////

////////////////////////////////////////////////////
const familiaSchema = new Schema({
    _sotr: { type: Schema.Types.ObjectId, ref: `Sotrudnik`, required: true},
    prikaz: {type: String, required: true},
    data_prikaza: {type: Date, required: true},
    pred_znach: {type: String},
    new_znach: {type: String, required: true},
    data_dob: {type: Date, required: true},
    _who: {type: Schema.Types.ObjectId, ref: `Users`, required: true},
    descrip: {type: String},
    is_locked: Boolean,
})
 const familia = model('Familia', familiaSchema);
///////////////////////////////////////////////////

////////////////////////////////////////////////////
const uvolnenieSchema = new Schema({
    _sotr: { type: Schema.Types.ObjectId, ref: `Sotrudnik`, required: true},
    prikaz: {type: String, required: true},
    data_prikaza: {type: Date, required: true},
    data_uvol: {type: Date, required: true},
    data_dob: {type: Date, required: true},
    _who: {type: Schema.Types.ObjectId, ref: `Users`, required: true},
    descrip: {type: String},
    is_locked: Boolean,
})
 const uvolnenie = model('Uvolnenie', uvolnenieSchema);
///////////////////////////////////////////////////

////////////////////////////////////////////////////
const zaprosSchema = new Schema({
    _sotr: { type: Schema.Types.ObjectId, ref: `Sotrudnik`, required: true},
    deistvie: {type: String, required: true},
    obosnovanie: {type: String, required: true},
    prava: {type: String,},
    data_dob: {type: Date, required: true},
    _who: {type: Schema.Types.ObjectId, ref: `Users`, required: true},
    descrip: {type: String},
    is_locked: Boolean,
})
 const zapros = model('Zapros', zaprosSchema);
///////////////////////////////////////////////////

////////////////////////////////////////////////////
const svodkaSchema = new Schema({
    _sotr: { type: Schema.Types.ObjectId, ref: `Sotrudnik`, required: true},
    deistvie: {type: String, required: true},
    obosnovanie: {type: String, required: true},
    data_dob: {type: Date, required: true},
    _who: {type: Schema.Types.ObjectId, ref: `Users`, required: true},
    descrip: {type: String},
    is_locked: Boolean,
})
 const svodka = model('Svodka', svodkaSchema);
///////////////////////////////////////////////////

////////////////////////////////////////////////////
const revizorSchema = new Schema({
    _sotr: { type: Schema.Types.ObjectId, ref: `Sotrudnik`, required: true},
    deistvie: {type: String, required: true},
    obosnovanie: {type: String, required: true},
    data_dob: {type: Date, required: true},
    _who: {type: Schema.Types.ObjectId, ref: `Users`, required: true},
    descrip: {type: String},
    is_locked: Boolean,
})
 const revizor = model('Revizor', revizorSchema);
///////////////////////////////////////////////////

////////////////////////////////////////////////////
const chdtiSchema = new Schema({
    _sotr: { type: Schema.Types.ObjectId, ref: `Sotrudnik`, required: true},
    deistvie: {type: String, required: true},
    obosnovanie: {type: String, required: true},
    prava: {type: String,},
    data_dob: {type: Date, required: true},
    _who: {type: Schema.Types.ObjectId, ref: `Users`, required: true},
    descrip: {type: String},
    is_locked: Boolean,
})
 const chdti = model('ChdTI', chdtiSchema);
///////////////////////////////////////////////////

////////////////////////////////////////////////////
const aipsinSchema = new Schema({
    _sotr: { type: Schema.Types.ObjectId, ref: `Sotrudnik`, required: true},
    deistvie: {type: String, required: true},
    obosnovanie: {type: String, required: true},
    data_dob: {type: Date, required: true},
    _who: {type: Schema.Types.ObjectId, ref: `Users`, required: true},
    descrip: {type: String},
    is_locked: Boolean
})
 const aipsin = model('Aipsin', aipsinSchema);
///////////////////////////////////////////////////

////////////////////////////////////////////////////
const adtoolSchema = new Schema({
    id_userA: {type: Number,},
    fio: {type: String,},
    date_s: {type: Date},
    date_p: {type: Date},
    prikaz: {type: String},
    who: {type: String, lowercase: true},
    date_z: {type: Date},
    descriptions: {type: String},
})
 const adtool = model('ADTool', adtoolSchema);
///////////////////////////////////////////////////

////////////////////////////////////////////////////
const stajirovkaSchema = new Schema({
    _sotr: { type: Schema.Types.ObjectId, ref: `Sotrudnik`, required: true},
    prikaz: {type: String, required: true},
    data_prikaza: {type: Date, required: true},
    data_n: {type: Date, required: true},
    data_k: {type: Date, required: true},
    _otkyda: { type: Schema.Types.ObjectId, ref: `Otdel`,required: true},
    _kyda: { type: Schema.Types.ObjectId, ref: `Otdel`, required: true},
    data_dob: {type: Date, required: true},
    _who: {type: Schema.Types.ObjectId, ref: `Users`, required: true},
    descrip: {type: String},
    is_locked: Boolean
})
 const stajirovka = model('Stajirovka', stajirovkaSchema);
///////////////////////////////////////////////////

////////////////////////////////////////////////////
const pravaItemSchema = new Schema({
    id: {
      type: Number,
      required: true,
    },
    status: {
      type: Number,
      enum: [0, 1, 2], // 0 — не выдано, 1 — выдано, 2 — спец
      required: true,
    },
    note: String, // по желанию
}, { _id: false });

const zaprosSPravaSchema = new Schema({
    _sotr: { type: Schema.Types.ObjectId, ref: `Sotrudnik`, required: true, unique:true},
    prikaz: {type: String, required: true},
    data_prikaza: {type: Date, required: true},
    data_dob: {type: Date, required: true},
    prava: {
        type: [pravaItemSchema],
        required: true,
        validate: {
          validator: function (arr) {
            const ids = arr.map(p => p.id);
            return new Set(ids).size === ids.length; // только уникальность id
          },
          message: 'ID прав не должны повторяться.',
        },
      },
    _who: {type: Schema.Types.ObjectId, ref: `Users`, required: true},
    descrip: {type: String},
    is_locked: Boolean
})
 const zaprosSPrava = model('ZaprosSPrava', zaprosSPravaSchema);
///////////////////////////////////////////////////

////////////////////////////////////////////////////
// const otpyskSchema = new Schema({
//     _sotr: { type: Schema.Types.ObjectId, ref: `Sotrudnik`, required: true},
//     prikaz: {type: String, required: true},
//     data_prikaza: {type: Date, required: true},
//     data_n_otp: {type: Date, required: true},
//     data_k_otp: {type: Date, required: true},
//     type: {type: String, required: true},
//     data_dob: {type: Date, required: true},
//     _who: {type: Schema.Types.ObjectId, ref: `Users`, required: true},
//     descrip: {type: String}
// })
//  const otpysk = model('Otpysk', otpyskSchema);
///////////////////////////////////////////////////

////////////////////////////////////////////////////
// const izmeneniaSchema = new Schema({
//     _sotr: { type: Schema.Types.ObjectId, ref: `Sotrudnik`, required: true},
//     old_prikaz: {type: String, required: true},
//     new_prikaz: {type: String, required: true},
//     data_dob: {type: Date, required: true},
//     _who: {type: Schema.Types.ObjectId, ref: `Users`, required: true},
//     descrip: {type: String}
// })
// const izmenenia = model('Izmenenia', izmeneniaSchema);
// const newIzmen = new izmenenia({ _sotr: newSotr._id, old_prikaz: '1', new_prikaz:`2`,data_dob: new Date(), who: `TsyhanokYS`, descrip: `admin`});
// newIzmen.save()
// .then(user => console.log('Izmen сохранен:', user))
// .catch(err => console.error('Ошибка сохранения izmena'));
///////////////////////////////////////////////////

////////////////////////////////////////////////////
// const obychenieSchema = new Schema({
//     _sotr: { type: Schema.Types.ObjectId, ref: `Sotrudnik`, required: true},
//     prikaz: {type: String, required: true},
//     data_prikaza: {type: Date, required: true},
//     data_n_obych: {type: Date, required: true},
//     data_k_obych: {type: Date, required: true},
//     data_dob: {type: Date, required: true},
//     _who: {type: Schema.Types.ObjectId, ref: `Users`, required: true},
//     descrip: {type: String}
// })
//  const obychenie = model('Obychenie', obychenieSchema);
// const newObych = new obychenie({ name: `Старший инспектор`, descrip: ''});
// newObych.save()
// .then(user => console.log('Obych сохранен:', user))
// .catch(err => console.error('Ошибка сохранения obychen'));
///////////////////////////////////////////////////

////////////////////////////////////////////////////
// const dekretSchema = new Schema({
//     _sotr: { type: Schema.Types.ObjectId, ref: `Sotrudnik`, required: true},
//     prikaz: {type: String, required: true},
//     data_prikaza: {type: Date, required: true},
//     data_n_dekr: {type: Date, required: false},
//     data_k_dekr: {type: Date, required: true},
//     data_dob: {type: Date, required: true},
//     _who: {type: Schema.Types.ObjectId, ref: `Users`, required: true},
//     descrip: {type: String}
// })
//  const dekret = model('Dekret', dekretSchema);
///////////////////////////////////////////////////


module.exports = {
    Otdel:otdel,
    Doljnost: doljnost,
    Sotrudnik: sotrudnik,
    Users: users,
    Pdoka: pdoka,
    Mongoose: mongoose,
    Priem: priem,
    SbrosAD: sbrosad,
    Subject: subject,
    Prodlenie: prodlenie,
    Company: company,
    Contract: contract,
    Access: access,
    Feedback: feedback,
    Naznachenie: naznachenie,
    Perevod: perevod,
    VPerevod: vperevod,
    Familia: familia,
    Uvolnenie: uvolnenie,
    Zapros: zapros,
    Svodka: svodka,
    Revizor: revizor,
    ChdTI: chdti,
    Aipsin: aipsin,
    ADTool: adtool,
    Stajirovka: stajirovka,
    ZaprosSPrava: zaprosSPrava,
    
}