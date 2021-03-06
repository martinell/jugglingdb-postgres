/**
 * Module dependencies
 */
var pg = require('pg');
var jdb = require('jugglingdb');
var util = require('util');

exports.initialize = function initializeSchema(schema, callback) {
    if (!pg) return;

    var Client = pg.Client;
    var s = schema.settings;
    schema.client = new Client(s.url ? s.url : {
        host: s.host || 'localhost',
        port: s.port || 5432,
        user: s.username,
        password: s.password,
        database: s.database,
        debug: s.debug
    });
    schema.adapter = new PG(schema.client);

    schema.adapter.connect(callback);
};

function PG(client) {
    this._models = {};
    this.client = client;
}

require('util').inherits(PG, jdb.BaseSQL);

PG.prototype.connect = function (callback) {
    this.client.connect(function (err) {
        if (!err){
            callback();
        }else{
            console.error(err);
            throw err;
        }
    });
};

PG.prototype.query = function () {
    var time = Date.now();
    var log = this.log;

    // Get arguments passed to this function
    var queryArgs = Array.prototype.slice.call(arguments);

    // Replace the callback
    var callback = queryArgs.pop();
    var queryCallback = function (err, data) {
        if (log) log(sql, time);
        callback(err, data ? data.rows : null);
    };

    // Get SQL query or queries
    var sql = queryArgs[0];
    var queries = (sql instanceof Array) ? sql : [sql];

    var self = this;
    queries.forEach( function(query, index) {
        queryArgs[0] = query;
        if (index === queries.length-1) {
            queryArgs.push(queryCallback);
        }
        self.client.query.apply(self.client, queryArgs);
    });
};

/**
 * Must invoke callback(err, id)
 */
PG.prototype.create = function (model, data, callback) {
    var values = [];
    var fields = this.toFields2(model, data, true, values);
    var sql = 'INSERT INTO ' + this.tableEscaped(model) + '';
    if (fields) {
        sql += ' ' + fields;
    } else {
        sql += ' VALUES ()';
    }
    sql += ' RETURNING id';
    this.query(sql, values, function (err, info) {
        if (err) return callback(err);
        callback(err, info && info[0] && info[0].id);
    });
};

PG.prototype.updateOrCreate = function (model, data, callback) {
    var pg = this;
    var fieldsNames = [];
    var fieldValues = [];
    var combined = [];
    var props = this._models[model].properties;
    var values = [];
    Object.keys(data).forEach(function (key) {
        if (props[key] || key === 'id') {
            var k = '"' + key + '"';
            var v;
            if (key !== 'id') {
                v = pg.unEscapedToDatabase(props[key], data[key], values);
            } else {
                v = data[key];
            }
            fieldsNames.push(k);
            fieldValues.push(v);
            if (key !== 'id') combined.push(k + ' = ' + v);
        }
    });
    var update = 'UPDATE ' + this.tableEscaped(model);
    update += ' SET ' + combined + ' WHERE id = ' + data.id + ';';
    var insert = ' INSERT INTO ' + this.tableEscaped(model);
    insert += ' (' + fieldsNames.join(', ') + ')';
    insert += ' SELECT ' + fieldValues.join(', ')
    insert += ' WHERE NOT EXISTS (SELECT 1 FROM ' + this.tableEscaped(model);
    insert += ' WHERE id = ' + data.id + ') RETURNING id';

    this.query([update, insert], values, function (err, info) {
        if (!err && info && info[0] && info[0].id) {
            data.id = info[0].id;
        }
        callback(err, data);
    });
};

PG.prototype.toFields = function (model, data, forCreate) {
    var fields = [];
    var props = this._models[model].properties;

    if(forCreate){
      var columns = [];
      Object.keys(data).forEach(function (key) {
          if (props[key]) {
              if (key === 'id') return;
              columns.push('"' + key + '"');
              fields.push(this.toDatabase(props[key], data[key]));
          }
      }.bind(this));
      return '(' + columns.join(',') + ') VALUES ('+fields.join(',')+')';
    }else{
      Object.keys(data).forEach(function (key) {
          if (props[key]) {
              fields.push('"' + key + '" = ' + this.toDatabase(props[key], data[key]));
          }
      }.bind(this));
      return fields.join(',');
    }
};

PG.prototype.toFields2 = function (model, data, forCreate, valuesArray) {
    var fields = [];
    var props = this._models[model].properties;

    if(forCreate){
      var columns = [];
      Object.keys(data).forEach(function (key) {
          if (props[key]) {
              if (key === 'id') return;
              columns.push('"' + key + '"');
              fields.push(this.unEscapedToDatabase(props[key], data[key], valuesArray));
          }
      }.bind(this));
      return '(' + columns.join(',') + ') VALUES ('+fields.join(',')+')';
    }else{
      Object.keys(data).forEach(function (key) {
          if (props[key]) {
              fields.push('"' + key + '" = ' + this.unEscapedToDatabase(props[key], data[key], valuesArray));
          }
      }.bind(this));
      return fields.join(',');
    }
};

function dateToPostgres(val) {
    return [
        val.getFullYear(),
        fz(val.getMonth() + 1),
        fz(val.getDate())
    ].join('-') + ' ' + [
        fz(val.getHours()),
        fz(val.getMinutes()),
        fz(val.getSeconds())
    ].join(':');

    function fz(v) {
        return v < 10 ? '0' + v : v;
    }
}

PG.prototype.toDatabase = function (prop, val) {
    if (val === null) {
		// Postgres complains with NULLs in not null columns
		// If we have an autoincrement value, return DEFAULT instead
        if( prop.autoIncrement ) {
            return 'DEFAULT';
        }
        else {
            return 'NULL';
	    }
    }
    if (val.constructor.name === 'Object') {
        var operator = Object.keys(val)[0]
        val = val[operator];
        if (operator === 'between') {
            return this.toDatabase(prop, val[0]) + ' AND ' + this.toDatabase(prop, val[1]);
        }
        if (operator === 'inq' || operator === 'nin') {
            for (var i = 0; i < val.length; i++) {
                val[i] = escape(val[i]);
                //val[i] = (val[i]);
            }
            return val.join(',');
        }
    }
    if (prop.type.name === 'Number') {
      if (!val && val!=0) {
          if( prop.autoIncrement ) {
              return 'DEFAULT';
          }
          else {
              return 'NULL';
          }
      }
      return val
    };

    if (prop.type.name === 'Date') {
        if (!val) {
            if( prop.autoIncrement ) {
                return 'DEFAULT';
            }
            else {
                return 'NULL';
            }
        }
        if (!val.toUTCString) {
            val = new Date(val);
        }
        //return escape(dateToPostgres(val));
        return escape(dateToPostgres(val));
    }
    return escape(val.toString());
    //return (val.toString());

};


PG.prototype.unEscapedToDatabase = function (prop, val, filterValues) {
    if (val === null) {
        // Postgres complains with NULLs in not null columns
        // If we have an autoincrement value, return DEFAULT instead
        if( prop.autoIncrement ) {
            return 'DEFAULT';
        }
        else {
            return 'NULL';
        }
    }
    if (val.constructor.name === 'Object') {
        var operator = Object.keys(val)[0]
        val = val[operator];
        if (operator === 'between') {
            return this.unEscapedToDatabase(prop, val[0], filterValues) + ' AND ' + this.unEscapedToDatabase(prop, val[1], filterValues);
        }
        if (operator === 'inq' || operator === 'nin') {
            var vals = [];
            for (var i = 0; i < val.length; i++) {
                //val[i] = escape(val[i]);
                filterValues.push(val[i]);
                var filterValue = "$" + filterValues.length;
                vals.push(filterValue)
            }
            return vals.join(',');
        }
    }
    if (prop.type.name === 'Number') {
        if (!val && val!=0) {
            if( prop.autoIncrement ) {
                return 'DEFAULT';
            } else {
            return 'NULL';
            }
        }
        filterValues.push(val);
        return "$" + filterValues.length;
        //return val;
    };

    if (prop.type.name === 'Date') {
        if (!val) {
            if( prop.autoIncrement ) {
                return 'DEFAULT';
            }
            else {
                return 'NULL';
            }
        }
        if (!val.toUTCString) {
            val = new Date(val);
        }
        //return escape(dateToPostgres(val));
        //return (dateToPostgres(val));

        filterValues.push(dateToPostgres(val));
        return "$" + filterValues.length;
    }
    //return escape(val.toString());
    //return (val.toString());
    filterValues.push(val.toString());
    return "$" + filterValues.length;

};

PG.prototype.fromDatabase = function (model, data) {
    if (!data) return null;
    var props = this._models[model].properties;
    Object.keys(data).forEach(function (key) {
        var val = data[key];
        data[key] = val;
    });
    return data;
};

PG.prototype.escapeName = function (name) {
    return '"' + name.replace(/\./g, '"."') + '"';
};

PG.prototype.getColumns = function(model){
    return '"' + Object.keys(this._models[model].properties).join('", "') + '"';
}


PG.prototype.all = function all(model, filter, callback) {
    var processedFilter = this.toFilter(model, filter);
    this.query('SELECT ' + this.getColumns(model) +  '  FROM ' + this.tableEscaped(model) + ' ' + processedFilter.filterExp, processedFilter.values, function (err, data) {
        if (err) {
            console.log(err);
            return callback(err, []);
        }
        if (filter && filter.include) {
            this._models[model].model.include(data, filter.include, callback);
        } else {
            callback(null, data);
        }
    }.bind(this));
};

PG.prototype.toFilter = function (model, filter) {
    if (filter && typeof filter.where === 'function') {
      return filter();
    }
    if (!filter) return '';
    var filterValues = [];
    var props = this._models[model].properties;
    var out = '';
    if (filter.where) {
        var fields = [];
        var conds = filter.where;
        Object.keys(conds).forEach(function (key) {
            if (filter.where[key] && filter.where[key].constructor.name === 'RegExp') {
                var regex = filter.where[key];
                var sqlCond = '"' + key + '"';

                if (regex.ignoreCase) {
                    sqlCond += ' ~* ';
                } else {
                    sqlCond += ' ~ ';
                }

                sqlCond += "'"+regex.source+"'";

                fields.push(sqlCond);

                return;
            }
            if (props[key]) {
                var filterValue = this.unEscapedToDatabase(props[key], filter.where[key], filterValues);
                if (filterValue === 'NULL') {
                    fields.push('"' + key + '" IS ' + filterValue);
                } else{
                    if (conds[key].constructor.name === 'Object') {
                        var condType = Object.keys(conds[key])[0];
                        var sqlCond = '"' + key + '"';
                        if ((condType === 'inq' || condType === 'nin') && filterValue.length === 0) {
                            fields.push(condType == 'inq' ? 'FALSE' : 'TRUE');
                            return true;
                        }
                        switch (condType) {
                            case 'gt':
                                sqlCond += ' > ';
                                break;
                            case 'gte':
                                sqlCond += ' >= ';
                                break;
                            case 'lt':
                                sqlCond += ' < ';
                                break;
                            case 'lte':
                                sqlCond += ' <= ';
                                break;
                            case 'between':
                                sqlCond += ' BETWEEN ';
                                break;
                            case 'inq':
                                sqlCond += ' IN ';
                                break;
                            case 'nin':
                                sqlCond += ' NOT IN ';
                                break;
                            case 'neq':
                                sqlCond += ' != ';
                                break;
                            case 'like':
                                sqlCond += ' LIKE ';
                                break;
                            case 'nlike':
                                sqlCond += ' NOT LIKE ';
                                break;
                            default:
                                sqlCond += ' ' + condType + ' ';
                                break;
                        }
                        //filterValues.push(filterValue);
                        //filterValue = "$" + filterValues.length;
                        sqlCond += (condType == 'inq' || condType == 'nin') ? '(' + filterValue + ')' : filterValue;
                        fields.push(sqlCond);
                    } else {
                        //filterValues.push(filterValue);
                        //filterValue = "$" + filterValues.length;
                        fields.push('"' + key + '" = ' + filterValue);
                    }
                }
            }
        }.bind(this));
        if (fields.length) {
            out += ' WHERE ' + fields.join(' AND ');
        }
    }

    if (filter.order) {
        out += ' ORDER BY ' + filter.order;
    }

    if (filter.limit) {
        filterValues.push(filter.limit);
        var limitField = "$" + filterValues.length;
        offsetField = '0';
        if (filter.offset) {
            filterValues.push(filter.offset);
            var offsetField = "$" + filterValues.length;
        }
        out += ' LIMIT ' + limitField + ' OFFSET ' + offsetField;
    }

    return {filterExp: out, values: filterValues};
};

function getTableStatus(model, cb){
    function decoratedCallback(err, data){
        data.forEach(function(field){
            field.Type = mapPostgresDatatypes(field.Type);
        });
        cb(err, data);
    };
    this.query('SELECT column_name as "Field", udt_name as "Type", is_nullable as "Null", column_default as "Default" FROM information_schema.COLUMNS WHERE table_name = $1', [this.table(model)], decoratedCallback);
};

PG.prototype.autoupdate = function (cb) {
    var self = this;
    var wait = 0;
    Object.keys(this._models).forEach(function (model) {
        wait += 1;
        var fields;
        getTableStatus.call(self, model, function(err, fields){
            if (!err && fields.length) {
                self.alterTable(model, fields, done);
            } else {
                self.createTable(model, done);
            }
        });
    });

    function done(err) {
        if (err) {
            console.log(err);
        }
        if (--wait === 0 && cb) {
            cb();
        }
    };
};

PG.prototype.isActual = function(cb) {
    var self = this;
    var wait = 0;
    changes = [];
    Object.keys(this._models).forEach(function (model) {
        wait += 1;
        getTableStatus.call(self, model, function(err, fields){
            changes = changes.concat(getPendingChanges.call(self, model, fields));
            done(err, changes);
        });
    });

    function done(err, fields) {
        if (err) {
            console.log(err);
        }
        if (--wait === 0 && cb) {
            var actual = (changes.length === 0);
            cb(null, actual);
        }
    };
};

PG.prototype.alterTable = function (model, actualFields, done) {
  var self = this;
  var pendingChanges = getPendingChanges.call(self, model, actualFields);
  applySqlChanges.call(self, model, pendingChanges, done);
};

function getPendingChanges(model, actualFields){
    var sql = [];
    var self = this;
    sql = sql.concat(getColumnsToAdd.call(self, model, actualFields));
    sql = sql.concat(getPropertiesToModify.call(self, model, actualFields));
    sql = sql.concat(getColumnsToDrop.call(self, model, actualFields));
    return sql;
};

function getColumnsToAdd(model, actualFields){
    var self = this;
    var m = self._models[model];
    var propNames = Object.keys(m.properties);
    var sql = [];
    propNames.forEach(function (propName) {
        if (propName === 'id') return;
        var found = searchForPropertyInActual.call(self, propName, actualFields);
        if(!found && propertyHasNotBeenDeleted.call(self, model, propName)){
            sql.push(addPropertyToActual.call(self, model, propName));
        }
    });
    return sql;
};

function addPropertyToActual(model, propName){
    var self = this;
    var p = self._models[model].properties[propName];
    var sqlCommand = 'ADD COLUMN "' + propName + '" ' + datatype(p) + " " + (propertyCanBeNull.call(self, model, propName) ? "" : " NOT NULL");
    return sqlCommand;
};

function searchForPropertyInActual(propName, actualFields){
    var found = false;
    actualFields.forEach(function (f) {
        if (f.Field === propName) {
            found = f;
            return;
        }
    });
    return found;
};

function getPropertiesToModify(model, actualFields){
    var self = this;
    var sql = [];
    var m = self._models[model];
    var propNames = Object.keys(m.properties);
    var found;
    propNames.forEach(function (propName) {
        if (propName === 'id') return;
        found = searchForPropertyInActual.call(self, propName, actualFields);
        if(found && propertyHasNotBeenDeleted.call(self, model, propName)){
            if (datatypeChanged(propName, found)) {
                sql.push(modifyDatatypeInActual.call(self, model, propName));
            }
            if (nullabilityChanged(propName, found)){
                sql.push(modifyNullabilityInActual.call(self, model, propName));
            }
        }
    });

    return sql;

    function datatypeChanged(propName, oldSettings){
        var newSettings = m.properties[propName];
        if(!newSettings) return false;
        return oldSettings.Type.toLowerCase() !== datatype(newSettings);
    };

    function nullabilityChanged(propName, oldSettings){
        var newSettings = m.properties[propName];
        if(!newSettings) return false;
        var changed = false;
        if (oldSettings.Null === 'YES' && (newSettings.allowNull === false || newSettings.null === false)) changed = true;
        if (oldSettings.Null === 'NO' && !(newSettings.allowNull === false || newSettings.null === false)) changed = true;
        return changed;
    };
};

function modifyDatatypeInActual(model, propName) {
    var self = this;
    var sqlCommand = 'ALTER COLUMN "' + propName + '"  TYPE ' + datatype(self._models[model].properties[propName]);
    return sqlCommand;
};

function modifyNullabilityInActual(model, propName) {
    var self = this;
    var sqlCommand = 'ALTER COLUMN "' + propName + '" ';
    if(propertyCanBeNull.call(self, model, propName)){
      sqlCommand = sqlCommand + "DROP ";
    } else {
      sqlCommand = sqlCommand + "SET ";
    }
    sqlCommand = sqlCommand + "NOT NULL";
    return sqlCommand;
};

function getColumnsToDrop(model, actualFields){
    var self = this;
    var sql = [];
    actualFields.forEach(function (actualField) {
        if (actualField.Field === 'id') return;
        if (actualFieldNotPresentInModel(actualField, model)) {
            sql.push('DROP COLUMN "' + actualField.Field + '"');
        }
    });
    return sql;

    function actualFieldNotPresentInModel(actualField, model){
        return !(self._models[model].properties[actualField.Field]);
    };
};

function applySqlChanges(model, pendingChanges, done){
    var self = this;
    if (pendingChanges.length) {
       var thisQuery = 'ALTER TABLE ' + self.tableEscaped(model);
       var ranOnce = false;
       pendingChanges.forEach(function(change){
         if(ranOnce) thisQuery = thisQuery + ',';
         thisQuery = thisQuery + ' ' + change;
         ranOnce = true;
       });
       thisQuery = thisQuery + ';';
       self.query(thisQuery, [], callback);
    }

    function callback(err, data){
      if(err) console.log(err);
    }

    done();
};

PG.prototype.propertiesSQL = function (model) {
    var self = this;
    var sql = ['"id" SERIAL PRIMARY KEY'];
    Object.keys(this._models[model].properties).forEach(function (prop) {
        if (prop === 'id') return;
        sql.push('"' + prop + '" ' + self.propertySettingsSQL(model, prop));
    });
    return sql.join(',\n  ');

};

PG.prototype.propertySettingsSQL = function (model, propName) {
    var self = this;
    var p = self._models[model].properties[propName];
    var result = datatype(p) + ' ';
    if(!propertyCanBeNull.call(self, model, propName)) result = result + 'NOT NULL ';
    return result;
};

function propertyCanBeNull(model, propName){
    var p = this._models[model].properties[propName];
    return !(p.allowNull === false || p['null'] === false);
};

function escape(val) {
  if (val === undefined || val === null) {
    return 'NULL';
  }

  switch (typeof val) {
    case 'boolean': return (val) ? 'true' : 'false';
    case 'number': return val+'';
  }

  if (typeof val === 'object') {
    val = (typeof val.toISOString === 'function')
      ? val.toISOString()
      : val.toString();
  }

  val = val.replace(/[\0\n\r\b\t\\\'\"\x1a]/g, function(s) {
    switch(s) {
      case "\0": return "\\0";
      case "\n": return "\\n";
      case "\r": return "\\r";
      case "\b": return "\\b";
      case "\t": return "\\t";
      case "\x1a": return "\\Z";
      default: return "\\"+s;
    }
  });
  return "E'"+val+"'";
};

function datatype(p) {
    switch (p.type.name) {
        default:
        case 'String':
        case 'JSON':
        return 'varchar';
        case 'Text':
        return 'text';
        case 'Number':
        return 'integer';
        case 'Date':
        return 'timestamp';
        case 'Boolean':
        return 'boolean';
    }
};

function mapPostgresDatatypes(typeName) {
    //TODO there are a lot of synonymous type names that should go here-- this is just what i've run into so far
    switch (typeName){
        case 'int4':
          return 'integer';
        case 'bool':
          return 'boolean';
        default:
          return typeName;
    }
};

function propertyHasNotBeenDeleted(model, propName){
    return !!this._models[model].properties[propName];
};
