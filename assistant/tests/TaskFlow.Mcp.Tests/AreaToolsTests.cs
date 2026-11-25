using System.Net;
using AwesomeAssertions;
using ModelContextProtocol;
using TaskFlow.Mcp.Tools;

namespace TaskFlow.Mcp.Tests;

public class AreaToolsTests
{
    private const string Duplicate = "An area with this name already exists.";
    private const string HasProjects = "This area has projects. Choose where they go: moveToAreaId, newAreaName or noArea=true.";

    private static AreaTools Tools(StubHandler handler) => new(Fixtures.Client(handler));

    /// <summary>Work (#1) holds Alpha and the archived Old; Home (#2) holds Beta; Empty (#3) holds nothing.</summary>
    private static StubHandler Handler() => new StubHandler()
        .Get("Areas", new[] { Fixtures.Area(1, "Work", 2), Fixtures.Area(2, "Home", 1, 1), Fixtures.Area(3, "Empty", 0, 2) })
        .Get("Projects", new[]
        {
            Fixtures.Project(10, "Alpha", areaId: 1, areaName: "Work"),
            Fixtures.Project(11, "Old", archived: true, areaId: 1, areaName: "Work"),
            Fixtures.Project(12, "Beta", areaId: 2, areaName: "Home"),
        });

    private static async Task<string> ErrorOf(Func<Task<string>> act) =>
        (await act.Should().ThrowAsync<McpException>()).Which.Message;

    private static void AssertNoWrites(StubHandler handler) =>
        handler.Requests.Should().OnlyContain(r => r.Method == HttpMethod.Get);

    [Fact]
    public async Task ListAreas_KeepsApiOrder_AndSaysCountsIncludeArchived()
    {
        var handler = new StubHandler().Get("Areas", new[] { Fixtures.Area(2, "Zed", 3), Fixtures.Area(1, "Apple", 0, 1) });

        var text = await Tools(handler).ListAreas();

        text.Should().Be("2 area(s):\n#2 Zed - 3 project(s), including archived\n#1 Apple - 0 project(s), including archived");
    }

    [Fact]
    public async Task ListAreas_WhenEmpty_PointsToSaveArea() =>
        (await Tools(new StubHandler().Get("Areas", Array.Empty<object>())).ListAreas()).Should().Contain("save_area");

    [Fact]
    public async Task SaveArea_Creates_WithATrimmedName()
    {
        var handler = new StubHandler().Post("Areas", Fixtures.Area(4, "Garden"), HttpStatusCode.Created);

        var text = await Tools(handler).SaveArea(" Garden ");

        handler.BodyOf(HttpMethod.Post, "Areas").GetProperty("name").GetString().Should().Be("Garden");
        text.Should().Be("Created area: #4 Garden");
    }

    [Theory]
    [InlineData("work")]
    [InlineData("1")]
    public async Task SaveArea_Renames_ByNameOrId(string area)
    {
        var handler = Handler().Put("Areas/1", Fixtures.Area(1, "Office", 2));

        var text = await Tools(handler).SaveArea("Office", area);

        handler.BodyOf(HttpMethod.Put, "Areas/1").GetProperty("name").GetString().Should().Be("Office");
        handler.Sent(HttpMethod.Post, "Areas").Should().BeEmpty();
        text.Should().Be("Renamed area #1 from 'Work' to 'Office'.");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("Work")]
    public async Task SaveArea_DuplicateName_SaysNothingChanged(string? area)
    {
        var handler = Handler()
            .Post("Areas", new { message = Duplicate }, HttpStatusCode.Conflict)
            .Put("Areas/1", new { message = Duplicate }, HttpStatusCode.Conflict);

        var message = await ErrorOf(() => Tools(handler).SaveArea("Home", area));

        message.Should().Be(Duplicate + "\nNothing was changed. That area name is already used; check list_areas and choose a different name.");
    }

    [Fact]
    public async Task SaveArea_BlankName_SendsNothing()
    {
        var handler = Handler();

        (await ErrorOf(() => Tools(handler).SaveArea("  ", "Work"))).Should().Contain("'name'");
        handler.Requests.Should().BeEmpty();
    }

    [Theory]
    [InlineData("Garden", "No area matches 'Garden'*'Work' (#1)*")]
    [InlineData("o", "Area 'o' is ambiguous*'Work'*'Home'*")]
    public async Task UnknownOrAmbiguousArea_GivesGuidance_AndWritesNothing(string area, string expected)
    {
        var handler = Handler();
        var tools = Tools(handler);

        await FluentActions.Awaiting(() => tools.SaveArea("New", area)).Should().ThrowAsync<McpException>().WithMessage(expected);
        await FluentActions.Awaiting(() => tools.DeleteArea(area, confirmed: true)).Should().ThrowAsync<McpException>().WithMessage(expected);
        await FluentActions.Awaiting(() => tools.DeleteArea("Work", moveToArea: area, confirmed: true)).Should().ThrowAsync<McpException>().WithMessage(expected);
        AssertNoWrites(handler);
    }

    [Fact]
    public async Task DeleteArea_Empty_DeletesAtOnce_AndNamesTheArea()
    {
        var handler = Handler().Delete("Areas/3");

        var text = await Tools(handler).DeleteArea("Emp");

        handler.Sent(HttpMethod.Delete, "Areas/3").Should().ContainSingle().Which.Query.Should().BeEmpty();
        text.Should().Be("Deleted area #3 'Empty'. It had no projects.");
    }

    [Theory]
    [InlineData("Home", null, "moveToArea was not used")]
    [InlineData(null, "Garden", "newAreaName was not used: no area was created.")]
    public async Task DeleteArea_Empty_SendsNoChoice_AndSaysItWasNotUsed(string? moveToArea, string? newAreaName, string expected)
    {
        var handler = Handler().Delete("Areas/3");

        var text = await Tools(handler).DeleteArea("Empty", moveToArea, newAreaName, confirmed: true);

        handler.Sent(HttpMethod.Delete, "Areas/3").Should().ContainSingle().Which.Query.Should().BeEmpty();
        text.Should().Contain(expected);
    }

    [Theory]
    [InlineData("home", null, false, "?moveToAreaId=2", "Moved to area #2 'Home'")]
    [InlineData(null, " R & D ", false, "?newAreaName=R%20%26%20D", "Moved to the new area 'R & D'")]
    [InlineData(null, null, true, "?noArea=true", "Now without an area")]
    public async Task DeleteArea_ConfirmedChoice_SendsOnlyThatParameter_AndNamesTheMovedProjects(
        string? moveToArea, string? newAreaName, bool leave, string query, string outcome)
    {
        var handler = Handler().Delete("Areas/1");

        var text = await Tools(handler).DeleteArea("Work", moveToArea, newAreaName, leave, confirmed: true);

        handler.Sent(HttpMethod.Delete, "Areas/1").Should().ContainSingle().Which.Query.Should().Be(query);
        text.Should().Be($"Deleted area #1 'Work'. {outcome}, 2 project(s): #10 Alpha, #11 Old (archived)");
    }

    [Theory]
    [InlineData(null, null, false, false)]
    [InlineData(null, null, false, true)]
    [InlineData("Home", null, false, false)]
    [InlineData(null, "Garden", false, false)]
    [InlineData(null, null, true, false)]
    public async Task DeleteArea_WithoutChoiceOrConfirmation_ReturnsThePreview(string? moveToArea, string? newAreaName, bool leave, bool confirmed)
    {
        var handler = Handler();

        var text = await Tools(handler).DeleteArea("Work", moveToArea, newAreaName, leave, confirmed);

        text.Should().StartWith("Nothing was deleted.")
            .And.Contain("#1 'Work' has 2 project(s)")
            .And.Contain("#10 Alpha\n").And.Contain("#11 Old (archived)").And.NotContain("Beta")
            .And.Contain("moveToArea:").And.Contain("newAreaName:").And.Contain("leaveProjectsWithoutArea=true:")
            .And.Contain("confirmed=true").And.NotContain("already taken");
        AssertNoWrites(handler);
    }

    [Theory]
    [InlineData("hom", null, false, "Requested: moveToArea #2 'Home'")]
    [InlineData(null, "Garden", false, "Requested: newAreaName 'Garden'")]
    [InlineData(null, null, true, "Requested: leaveProjectsWithoutArea=true")]
    public async Task DeleteArea_Preview_EchoesTheSuppliedChoice(string? moveToArea, string? newAreaName, bool leave, string expected) =>
        (await Tools(Handler()).DeleteArea("Work", moveToArea, newAreaName, leave)).Should().Contain(expected);

    [Theory]
    [InlineData(" HOME ", "#2 'Home'")]
    [InlineData("work", "#1 'Work'")]
    public async Task DeleteArea_Preview_FlagsATakenNewAreaName(string newAreaName, string takenBy) =>
        (await Tools(Handler()).DeleteArea("Work", newAreaName: newAreaName))
            .Should().Contain($"already taken by area {takenBy}, so the delete would be refused");

    [Theory]
    [InlineData("Home", "Garden", false, "only one of")]
    [InlineData("Home", null, true, "only one of")]
    [InlineData(null, "Garden", true, "only one of")]
    [InlineData("1", null, false, "different area")]
    public async Task DeleteArea_TwoChoicesOrSelfTarget_SendsNoDelete(string? moveToArea, string? newAreaName, bool leave, string expected)
    {
        var handler = Handler();

        var message = await ErrorOf(() => Tools(handler).DeleteArea("Work", moveToArea, newAreaName, leave, confirmed: true));

        message.Should().Contain(expected);
        AssertNoWrites(handler);
    }

    [Fact]
    public async Task DeleteArea_TakenNewName_Conflict_PointsToMoveToArea()
    {
        var handler = Handler().Delete("Areas/1", HttpStatusCode.Conflict, new { message = Duplicate });

        var message = await ErrorOf(() => Tools(handler).DeleteArea("Work", newAreaName: "Home", confirmed: true));

        message.Should().Be(Duplicate + "\nNothing was changed. That area name is already used: pass it as moveToArea, or choose a different newAreaName.");
    }

    [Fact]
    public async Task DeleteArea_ProjectAddedToAnEmptyArea_Conflict_SaysToLookAgain()
    {
        var handler = Handler().Delete("Areas/3", HttpStatusCode.Conflict, new { message = HasProjects });

        var message = await ErrorOf(() => Tools(handler).DeleteArea("Empty"));

        message.Should().Be(HasProjects + "\nNothing was changed. This area now has projects: call delete_area again to see them, then choose moveToArea, newAreaName or leaveProjectsWithoutArea=true.");
    }

    [Theory]
    [InlineData(HttpStatusCode.BadRequest, "Home", false, "Target area not found.")]
    [InlineData(HttpStatusCode.Conflict, "Home", false, "Some other conflict.")]
    [InlineData(HttpStatusCode.Conflict, null, true, "Some other conflict.")]
    public async Task DeleteArea_OtherRefusals_PointToListAreas(HttpStatusCode status, string? moveToArea, bool leave, string apiMessage)
    {
        var handler = Handler().Delete("Areas/1", status, new { message = apiMessage });

        var message = await ErrorOf(() => Tools(handler).DeleteArea("Work", moveToArea, leaveProjectsWithoutArea: leave, confirmed: true));

        message.Should().Be(apiMessage + "\nNothing was changed. Check the areas with list_areas, then call delete_area again with exactly one of moveToArea, newAreaName or leaveProjectsWithoutArea=true.");
    }
}
