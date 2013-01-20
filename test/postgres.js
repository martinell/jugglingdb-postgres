var jdb = require('jugglingdb'),
    Schema = jdb.Schema,
    test = jdb.test,
    schema = new Schema(__dirname + '/..', {
        database:'jugglingdb',
        username:'dbadmin',
        password: 'dbadmin',
        port: 7777
    });

test(module.exports, schema);


test.it('all should support regex', function (test) {
    Post = schema.models.Post;

    Post.destroyAll(function () {
        Post.create({title:'Postgres Test Title'}, function (err, post) {
            var id = post.id
            Post.all({where:{title:/^Postgres/}}, function (err, post) {
                test.ok(!err);
                test.ok(post[0].id == id);
                test.done();
            });
        });
    });
});

test.it('all should support arbitrary expressions', function (test) {
    Post.destroyAll(function () {
        Post.create({title:'Postgres Test Title'}, function (err, post) {
            var id = post.id
            Post.all({where:{title:{ilike:'postgres%'}}}, function (err, post) {
                test.ok(!err);
                test.ok(post[0].id == id);
                test.done();
            });
        });
    });
});

test.it('findOne should not allow sql injection', function (test) {
    Post.destroyAll(function () {
        Post.create({title:'Postgres Test Title'}, function (err, post) {
            var id = post.id;
            Post.findOne({where: {id: "1  or 1 = 1; delete from \"posts\"; --"}}, function (err1, post1) {
                Post.all({where:{title:{ilike:'postgres%'}}}, function (err2, post2) {
                    test.ok(!err2);
                    test.ok(post2.length === 1);
                    test.done();
                });
            });
        });
    });
});

test.it('findOne inq should still work', function (test) {
    Post.destroyAll(function () {
        Post.create({title:'Postgres Test Title'}, function (err, post) {
            var id = post.id;
            Post.findOne({where: {id: {inq: [id, id + 1]}}}, function (err, post) {
                test.ok(!err);
                test.ok(post.id === id);
                test.done();
            });
        });
    });
});

test.it('findOne between should still work too', function (test) {
    Post.destroyAll(function () {
        Post.create({title:'Postgres Test Title'}, function (err, post) {
            var id = post.id;
            Post.findOne({where: {id: {between: [id -1, id + 1]}}}, function (err, post) {
                test.ok(!err);
                test.ok(post.id === id);
                test.done();
            });
        });
    });
});
